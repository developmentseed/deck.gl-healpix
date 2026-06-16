# Sentinel-2 Pipeline: Stage Split & Shared-Function Orchestration

**Status:** Draft
**Date:** 2026-05-07
**Branch:** `feature/healpix-sentinel-process`
**Replaces:** the implicitly-3-stage layout introduced by [2026-04-28-sentinel2-healpix-pipeline-design.md](./2026-04-28-sentinel2-healpix-pipeline-design.md)

## 1. Background

The current `sentinel2-zhealpix` package processes Sentinel-2 L2A reflectance zarrs into a HEALPix `parent_offsets` mosaic in three stages — scene processing (download + resample fused), tree-reduce merge, and pyramid build. Only the orchestrator (`orchestrate.py`) is a CLI; `merge` and `pyramid` are reachable only through `--skip-*` flags on the orchestrator. Per-band downloads are submitted as separate Dask tasks, but their outputs live as in-memory `Future`s — there is no on-disk artifact between download and resample.

That setup is fine for a one-shot end-to-end run, but it makes three reasonable workflows awkward or impossible:

- Run **only the merge step** against an existing folder of scene zarrs (e.g. after re-shooting one bad scene by hand).
- Run **only the pyramid step** against an existing `merged_base.zarr` (e.g. iterating on `--min-nside` / `--parent-levels`).
- **Inspect raw bands** between download and resample (e.g. comparing what the source actually delivered against what was resampled).

## 2. Goals

- Split the pipeline into four stages, each runnable as a standalone CLI subcommand: `download`, `healpix`, `merge`, `pyramid`.
- Keep one orchestrator CLI (`run-all`) that chains all four stages through a shared Dask cluster.
- Enforce architecturally that the standalone CLIs and the orchestrator call **the same per-input functions** — Dask is just an execution mode, not a parallel implementation.
- Make `run-all` idempotent and partial: it inspects what is already on disk and runs only the stages whose outputs are missing or stale.
- Persist the download artifact as a local zarr that mirrors the relevant `measurements/reflectance/<group>` subgroup, so that the existing `zarr_utils` readers work unchanged on local mirrors.

## 3. Non-goals

- Distributed (multi-machine) Dask execution. `LocalCluster` only.
- Console scripts in `pyproject.toml` (`s2-download` etc.). Module-as-script invocation via `python -m sentinel2_zhealpix …` is sufficient.
- A `--start-at` / `--stop-at` flag on `run-all`. Stage selection is automatic from disk state.
- **Output-path overrides** per stage. Each stage writes to a fixed conventional sub-path under `--out-dir` (`raw/`, `scenes/`, `merged_base.zarr`, `mosaic.zarr`). Stage-specific output flags (e.g. `--mosaic-out`) are not exposed. Input-path overrides *are* supported (see §7).
- A backward-compatibility shim for `python -m sentinel2_zhealpix.orchestrate`. The branch is unreleased; we drop the entry point.

## 4. Architecture: shared per-input functions

Stage logic exists in exactly one place per stage — a function that takes one input and writes one on-disk artifact. Both the standalone CLI and the `run-all` orchestrator call these same functions. There is no Dask-only code path.

```
                    ┌──────────────────────────────────────────────┐
                    │           PER-INPUT FUNCTIONS                │
                    │  (the only place stage logic exists)         │
                    │                                              │
                    │  download.download_one_scene(url, cfg)       │
                    │  healpix.healpix_one_scene(raw_path, cfg)    │
                    │  merge.merge_pair_zarrs(a, b, out)           │
                    │  merge.tree_merge(scenes, cfg, executor)     │
                    │  pyramid.build_pyramid(merged_path, cfg)     │
                    └──────────────────────────────────────────────┘
                              ▲                         ▲
                              │                         │
                  ┌───────────┴──────────┐  ┌───────────┴──────────────┐
                  │  cli.py (per stage)  │  │  cli.py (run-all)         │
                  │                      │  │                           │
                  │ argparse → loop or   │  │ inspect disk → for each   │
                  │ Dask-submit the      │  │ stage NOT already done,   │
                  │ per-input function   │  │ Dask-submit the same      │
                  │                      │  │ per-input function        │
                  └──────────────────────┘  └───────────────────────────┘
```

Per-input functions implement their own **skip-if-output-exists** checkpoint. This means callers — CLI loop or Dask submission — can blindly call them; already-done work returns instantly.

## 5. Module layout

```
sentinel2_zhealpix/
├── __init__.py
├── __main__.py          # NEW: from .cli import main; main()
├── cli.py               # NEW: unified argparse with subcommands
├── config.py            # extended with computed-path properties
├── download.py          # NEW
├── healpix.py           # RENAMED from scene.py (and rescoped to read local zarrs)
├── healpix_utils.py     # unchanged
├── merge.py             # unchanged
├── pyramid.py           # unchanged
└── zarr_utils.py        # unchanged
```

`orchestrate.py` is removed. Its responsibilities move into `cli.py` as the `run-all` subcommand.

## 6. Output directory layout

```
output/
├── raw/                       # NEW: download stage output
│   └── 0000_<tile>.zarr       # mirror of measurements/reflectance/<group>
├── scenes/                    # healpix stage output (unchanged shape)
│   └── 0000_<tile>.zarr       # base-level HEALPix per scene
├── merge/                     # merge intermediates (unchanged)
│   └── r{round}_p{pair}.zarr
├── merged_base.zarr           # final merged base (unchanged)
└── mosaic.zarr                # final pyramid (unchanged)
```

Filename prefix `{i:04d}_<tile>` is preserved between `raw/` and `scenes/` so ordering is stable across stages.

## 7. CLI surface

All subcommands take `--out-dir` (where output is written, using the conventional sub-paths from §6). The three stages whose input is a folder or file accept an **optional input override** that lets you read inputs from somewhere other than the conventional sub-path under `--out-dir`:

| Stage | Input override flag | Defaults to |
|---|---|---|
| `healpix` | `--raw-dir DIR` | `--out-dir/raw` |
| `merge` | `--scenes-dir DIR` | `--out-dir/scenes` |
| `pyramid` | `--merged-base PATH` | `--out-dir/merged_base.zarr` |

`download` takes URLs as input (no folder to override) and `run-all` chains all four stages through `--out-dir` only — the input-override flags are intentionally not exposed on `run-all`.

```
python -m sentinel2_zhealpix download \
    --urls URL [URL ...] | --urls-file urls.txt \
    --out-dir ./output \
    [--reflectance-group r20m] [--workers N]

python -m sentinel2_zhealpix healpix \
    --out-dir ./output \
    [--raw-dir DIR] \
    [--base-nside N] [--subsamples K] [--workers N]

python -m sentinel2_zhealpix merge \
    --out-dir ./output \
    [--scenes-dir DIR] \
    [--workers N]

python -m sentinel2_zhealpix pyramid \
    --out-dir ./output \
    [--merged-base PATH] \
    [--min-nside 128] [--parent-levels 6]

python -m sentinel2_zhealpix run-all \
    --urls URL [URL ...] | --urls-file urls.txt \
    --out-dir ./output \
    [--reflectance-group …] [--base-nside …] [--subsamples …] \
    [--min-nside …] [--parent-levels …] [--workers N]
```

Flag matrix:

| Subcommand | URLs | input override | nside / subsamples | min-nside / parent-levels | --workers |
|---|:-:|:-:|:-:|:-:|:-:|
| `download` | required | — | — | — | yes |
| `healpix` | — | `--raw-dir` (optional) | yes | — | yes |
| `merge` | — | `--scenes-dir` (optional) | — | — | yes |
| `pyramid` | — | `--merged-base` (optional) | — | yes | no (single-process) |
| `run-all` | required | — | yes | yes | yes |

Worked example — input from a shared cache, output to a fresh workspace:

```bash
# raw zarrs already exist in /shared/raw/, write everything else to ./run-2026-05-07/
python -m sentinel2_zhealpix healpix --raw-dir /shared/raw --out-dir ./run-2026-05-07
python -m sentinel2_zhealpix merge   --out-dir ./run-2026-05-07
python -m sentinel2_zhealpix pyramid --out-dir ./run-2026-05-07
```

`--workers` defaults to `cpu_count() - 1`. For standalone subcommands (`download`, `healpix`, `merge`), `--workers == 1` runs inputs in a sequential Python loop and skips Dask cluster setup entirely (cleaner logs for small jobs). **`run-all` opens a `LocalCluster` only when `--workers` ≥ 2; when `--workers == 1` it chains stages directly with synchronous calls** — avoiding subprocess sysctl probes during pytest runs — **parallel stages resume automatically once `--workers` increases**.

## 8. Stage details

### 8.1 `download`

**Per-input function:** `download_one_scene(url: str, scene_index: int, config: PipelineConfig) -> str`

**Output artifact:** `{out_dir}/raw/{i:04d}_<tile>.zarr` mirroring the source's `measurements/reflectance/<group>` subgroup.

```
raw/0000_<tile>.zarr/
└── measurements/
    └── reflectance/
        └── r20m/                 # exactly the requested reflectance_group
            ├── x                 # 1D float64 UTM eastings (copied)
            ├── y                 # 1D float64 UTM northings (copied)
            ├── crs               # crs subgroup with attrs preserved
            ├── b2                # 2D float32 reflectance (copied with source chunks)
            ├── b3
            └── ...               # all bands present in the source group
```

**Root attrs** (added by `download_one_scene`):

```python
{
    "source_url": "<original product URL>",
    "reflectance_group": "r20m",
    "downloaded_at": "<ISO 8601 timestamp>",
    "format_version": 1,
}
```

**Scope of the mirror:** *only* the requested reflectance group is copied. Other resolution groups (e.g. r10m, r60m), product-level metadata outside `measurements/reflectance/<group>`, and provenance graphs are skipped. This keeps each raw artifact ~ matching one band-stack download (≈ 1 GB for r20m, 12 bands).

**Source chunking** is preserved per array. Healpix readers stream the data in source-defined chunks rather than re-chunking on disk.

**Skip-if-done:** if `raw/{i:04d}_*.zarr` exists, has matching `source_url` and `reflectance_group` root attrs, and has a complete `measurements/reflectance/<group>` group with all expected band arrays present, skip.

**Dask granularity:** one task per scene. All bands of one scene are downloaded sequentially inside `download_one_scene`. The current per-band Dask split (`download[i]-{band}`) is removed: at ~ 100 MB per band the bottleneck is bandwidth, not latency, so per-band parallelism doesn't speed wall-clock time on a single machine. (Easy to re-add later by submitting band downloads as sub-tasks if profiling proves otherwise.)

### 8.2 `healpix`

**Per-input function:** `healpix_one_scene(raw_zarr_path: str, config: PipelineConfig) -> str`

1. Open `raw_zarr_path` with `zarr_utils.load_one_band` / `load_reflectance` / `healpix_utils.detect_utm_epsg`. These already work transparently on a URL or a local filesystem path — no code change.
2. Derive scene index and tile slug from the raw filename (`0000_<tile>.zarr` → index 0, tile `<tile>`).
3. Skip-if-done: if `scenes/{i:04d}_<tile>.zarr` exists with matching `base_nside` and `bands` attrs, return its path.
4. Run `footprint_weighted_healpix` (unchanged) and `write_base_healpix_zarr` (unchanged).

**CLI input discovery:** the `healpix` subcommand globs `<raw-dir>/*.zarr` where `<raw-dir>` is `--raw-dir` if given, else `--out-dir/raw`. Results are sorted by filename (the `0000_`, `0001_` prefix gives stable ordering). If the directory is missing or empty, exit with `no raw scenes found in {raw_dir}/. Run 'download' first.` (or, when `--raw-dir` was given explicitly, `no raw scenes found in {raw_dir}/.`).

**Network reads vanish** from this stage — everything is local.

### 8.3 `merge`

**Per-input functions (unchanged):** `merge.merge_pair_zarrs(a, b, out)`, `merge.tree_merge(scene_paths, config, pair_executor)`.

**CLI input discovery:** glob `<scenes-dir>/*.zarr` where `<scenes-dir>` is `--scenes-dir` if given, else `--out-dir/scenes`. Sort by filename. If no scenes found, exit with `no scene zarrs in {scenes_dir}/. Run 'healpix' first.` (or, when `--scenes-dir` was given explicitly, `no scene zarrs in {scenes_dir}/.`).

**Output:** `--out-dir/merged_base.zarr` (intermediate `merge/r*_p*.zarr` checkpoints retained as today).

**Skip-if-done:** if `merged_base.zarr` exists, is a valid base zarr, and its `bands` attr matches the bands found in scene zarrs, skip.

### 8.4 `pyramid`

**Per-input function (unchanged):** `pyramid.build_pyramid(merged_zarr_path, config)`.

**CLI input:** reads `<merged-base>` where `<merged-base>` is `--merged-base` if given, else `--out-dir/merged_base.zarr`. If missing, exit with `no merged base zarr at {merged_base_path}. Run 'merge' first.` (or, when `--merged-base` was given explicitly, `no merged base zarr at {merged_base_path}.`).

**Output:** `--out-dir/mosaic.zarr`.

**Skip-if-done:** if `mosaic.zarr` exists with matching `min_nside` and `parent_levels` root attrs, skip.

**No Dask** — single-process. The pyramid build is one fast pass through the merged base; multi-processing offers no benefit and adds startup overhead.

### 8.5 `run-all`

Inspects disk and runs only what is missing. Anchors entirely on `--out-dir`: the per-stage input-override flags (`--raw-dir`, `--scenes-dir`, `--merged-base`) are intentionally not exposed on `run-all`. If you need cross-directory composition, run the standalone subcommands.

```python
def run_all(urls: list[str], config: PipelineConfig) -> None:
    if config.n_workers <= 1:
        # synchronous download/healpix/merge; no LocalCluster
        ...
        return
    with Client(LocalCluster(n_workers=config.n_workers, threads_per_worker=1, memory_limit=0)) as client:
        if not all_raw_present(urls, config):
            run_download_stage(urls, config, client)
        if not all_scenes_present(urls, config):
            run_healpix_stage(config, client)
        if not merged_base_present(config):
            run_merge_stage(config, client)
    if not mosaic_present(config):
        run_pyramid_stage(config)   # single-process either way
```

For the parallel path (`config.n_workers > 1`), each `run_*_stage` function that touches Dask:

1. Logs which stage is running and how many inputs are pending.
2. Submits the per-input function for every input as a named Dask task (`download[i]`, `healpix[i]`, `merge-r{round}_p{pair}`).
3. Gathers; per-input checkpoints make this a no-op for already-done work.

`run_pyramid_stage` is the exception: it runs `build_pyramid` directly in the orchestrator process (after the Dask client has been closed), since the pyramid build is a single fast pass that doesn't benefit from a worker round-trip.

Worked example — "we just need merge and pyramid":

```
$ python -m sentinel2_zhealpix run-all --urls-file urls.txt --out-dir ./output
[download] all 20 raw zarrs present, skipping
[healpix]  all 20 scene zarrs present and consistent, skipping
[merge]    merged_base.zarr missing — running 5 rounds, 20 → 1
[pyramid]  building pyramid from merged_base.zarr
```

## 9. `config.PipelineConfig` changes

Add path-derivation properties (no new constructor arguments):

```python
@property
def raw_dir(self) -> str:           return os.path.join(self.out_dir, "raw")

@property
def scenes_dir(self) -> str:        return os.path.join(self.out_dir, "scenes")

@property
def merge_dir(self) -> str:         return os.path.join(self.out_dir, "merge")

@property
def merged_base_path(self) -> str:  return os.path.join(self.out_dir, "merged_base.zarr")

@property
def mosaic_path(self) -> str:       return os.path.join(self.out_dir, "mosaic.zarr")
```

All modules import these instead of repeating `os.path.join(out_dir, …)`.

## 10. Test plan

| File | Action |
|---|---|
| `tests/test_zarr_utils.py` | unchanged |
| `tests/test_healpix_utils.py` | unchanged |
| `tests/test_merge.py` | unchanged |
| `tests/test_pyramid.py` | unchanged |
| `tests/test_scene.py` | renamed to `tests/test_healpix.py`; updated to construct a fake raw zarr in a tmp dir and call `healpix_one_scene` against the local path instead of a URL |
| `tests/test_download.py` | new — builds a fake source zarr in a tmp dir, runs `download_one_scene` against the local URL (a `file://` path), asserts the mirror has the expected `measurements/reflectance/<group>` shape and root attrs, asserts re-running is a no-op |
| `tests/test_cli.py` | new — smoke-tests that `python -m sentinel2_zhealpix --help` and each subcommand's `--help` parse cleanly. No full pipeline runs. |

`tests/test_orchestrate.py` is **not** added: `run-all` is exercised through the per-stage tests; argparse plumbing isn't unit-tested.

## 11. Migration notes

1. **`orchestrate.py` is removed.** Users must switch from `python -m sentinel2_zhealpix.orchestrate …` to `python -m sentinel2_zhealpix run-all …`. All shared flags (`--urls`, `--urls-file`, `--out-dir`, `--workers`, `--base-nside`, `--reflectance-group`, `--subsamples`, `--min-nside`, `--parent-levels`) carry over verbatim. The two `--skip-*` flags are removed: `--skip-merge` and `--skip-pyramid` are replaced by automatic disk-state inspection. To get the equivalent of "stop after Step 1", run `download` and `healpix` standalone instead.
2. **`scene.py` becomes `healpix.py`.** The new `healpix_one_scene` reads from a local raw zarr; `process_scene` (which downloaded over HTTP and resampled in one call) is gone. Callers in tests and the orchestrator are migrated.
3. **`raw/` subdir is added** under `--out-dir`. On first run after the upgrade, every scene re-downloads (no `raw/` from previous runs to skip from). Subsequent runs are checkpointed.
4. **README** is rewritten to document the four-stage CLI surface and the new disk-budget line item (`raw/` ≈ 1 GB × N scenes for r20m).

## 12. Out of scope / future work

- Per-band Dask granularity for `download_one_scene` (currently coarsened to one task per scene).
- `--input-dir` / `--output-dir` overrides on standalone subcommands for cross-directory composition.
- Distributed Dask execution (LocalCluster only for now).
- Streaming healpix that reads from `raw/` on-the-fly without materialising the full mirror — only worth doing if `raw/` disk usage becomes a real problem.
