# Sentinel-2 → HEALPix Zarr Pipeline Design

**Date:** 2026-04-28  
**Location:** `healpix-layers-deck.gl/sentinel2-zhealpix/`  
**Source notebooks:** `healpix-explorer/esa-zarr-sentinel-parent-offsets.ipynb`, `healpix-explorer/merge-healpix-parent-offset-zarr.ipynb`

---

## Goal

Convert a list of Sentinel-2 L2A reflectance Zarr products (hosted on remote S3) into a single merged HEALPix `parent_offsets` pyramid Zarr mosaic on local disk. The pipeline must handle datasets too large to load into memory all at once, and must parallelise as much work as possible on a single machine.

---

## Pipeline steps

### Step 1 — Scene processing (`scene.py`)

For each Sentinel-2 product URL:

1. Open the remote Zarr store and read `measurements/reflectance/r20m` — band arrays (float32, 2D) plus `x` and `y` UTM coordinate vectors.
2. Auto-detect the UTM EPSG from the store's CRS metadata, or fall back to parsing the UTM zone from the tile ID in the URL (e.g. `_T29SND_` → zone 29 → `EPSG:32629`).
3. Use `config.base_nside` (resolved before any scene is dispatched — see Orchestrator section below).
4. Footprint resample: for every pixel, treat it as a rectangle in UTM space. Place a K×K subgrid of sample points inside that rectangle (default K=4). Project all sample points to WGS-84, look up their HEALPix NESTED cell id, and accumulate a weighted mean per cell. Samples are processed in batches of 65,536 pixels to bound memory.
5. Write `cell_id` (int64, sorted) and `values` (float32, N×bands) to a per-scene zarr on local disk.

**Checkpointing:** if the output zarr already exists with matching `base_nside` and `bands` attrs, this scene is skipped entirely.

**Output path:** `{out_dir}/scenes/{scene_index:04d}_{tile_id}.zarr`

### Step 2 — Tree-reduce merge (`merge.py`)

Takes the list of per-scene zarr paths and reduces them to a single deduplicated base-level zarr using a **binary tree reduction**:

- Round 0: pairs (0,1), (2,3), (4,5) … are each merged independently in parallel.
- Round 1: pairs the outputs of round 0, again in parallel.
- Continues until one zarr remains.

Each merge of two zarrs:
1. Reads `cell_id` + `values` from both (already NESTED-sorted).
2. Concatenates them, assigns priority 0 to the left input and 1 to the right.
3. Sorts by `(cell_id, priority)` with `numpy.lexsort`.
4. Drops duplicates keeping the first occurrence (priority 0 = left wins).

**Merge semantics:** first file in sorted input order wins for any overlapping cell. Matches the existing notebook exactly.

**Memory per merge worker:** ~2 × one scene size. With 20 scenes at ~600 MB each, peak per-worker RAM is ~1.2 GB. The accumulator never grows beyond two zarrs at a time.

**Checkpointing:** each round output is written to `{out_dir}/merge/r{round}_p{pair}.zarr`. If it exists, that pair is skipped on resume.

**Output path:** `{out_dir}/merged_base.zarr`

### Step 3 — Pyramid (`pyramid.py`)

Reads the merged base zarr and writes the full `parent_offsets` pyramid:

- Starts at `base_nside` (e.g. 262144), steps down by ÷2 to `min_nside` (default 128).
- At each level, computes a dense CSR `parent_offsets` array of length `12 * nside_parent² + 1`. Parent `p` spans rows `[parent_offsets[p], parent_offsets[p+1])`.
- Coarser levels are computed by grouping immediate children (4 per parent) and averaging their values.
- All operations are vectorised numpy — no Python loops over cells.

**Output path:** `{out_dir}/mosaic.zarr`

---

## Directory layout

```
healpix-layers-deck.gl/
└── sentinel2-zhealpix/
    ├── pyproject.toml          # uv-managed dependencies
    ├── config.py               # PipelineConfig dataclass
    ├── healpix_utils.py        # footprint resampling, nside detection (no I/O)
    ├── zarr_utils.py           # zarr read/write helpers
    ├── scene.py                # Step 1: one scene → per-scene base zarr
    ├── merge.py                # Step 2: tree-reduce merge
    ├── pyramid.py              # Step 3: parent_offsets pyramid
    └── orchestrate.py          # CLI entrypoint, Dask LocalCluster
```

`orchestrate.py` is the only file that imports Dask. The step modules (`scene.py`, `merge.py`, `pyramid.py`) are pure Python and can be read, tested, and called independently.

---

## Module contracts

### `config.py`

```python
@dataclass
class PipelineConfig:
    urls: list[str]                 # Sentinel-2 product root URLs
    out_dir: str                    # root output directory (local)
    reflectance_group: str = "r20m"
    min_nside_pyramid: int = 128
    parent_levels: int = 6
    base_nside_override: int | None = None   # None = auto from first scene
    footprint_subsamples: int = 4            # K×K sub-samples per pixel
    pixel_batch: int = 65_536
    n_workers: int | None = None             # None = cpu_count() - 1
```

### `scene.py`

```python
def process_scene(url: str, scene_index: int, config: PipelineConfig) -> str:
    """Process one Sentinel-2 scene to a base-level HEALPix zarr.
    Returns the output zarr path. Skips if already done.
    scene_index is used to name the output file (e.g. 0003_T29SND.zarr)."""
```

### `merge.py`

```python
def tree_merge(scene_paths: list[str], config: PipelineConfig) -> str:
    """Binary tree reduction of per-scene zarrs → single merged base zarr.
    Each round is checkpointed. Returns merged zarr path."""
```

### `pyramid.py`

```python
def build_pyramid(merged_zarr_path: str, config: PipelineConfig) -> str:
    """Build parent_offsets pyramid from merged base zarr.
    Returns mosaic zarr path."""
```

### `orchestrate.py` — startup sequence

Before dispatching any Dask tasks, the orchestrator:

1. If `config.base_nside_override` is set, uses it directly.
2. Otherwise, opens the **first URL only** (not via Dask), reads its `x`/`y` coordinate vectors, and calls `recommend_nside_from_pixel_spacing`. The result is stored back into `config` so every scene worker receives the same `base_nside`.

This probe is fast (reads only the 1D coordinate arrays, not band data) and ensures all scenes are projected to the same HEALPix grid.

### `orchestrate.py` CLI

```
python -m sentinel2_zhealpix.orchestrate \
    --urls url1 url2 ...    \   # or --urls-file urls.txt (one URL per line)
    --out-dir ./output      \
    [--workers 8]           \   # Dask worker count (default: cpu_count() - 1)
    [--base-nside 262144]   \   # override auto-detected nside
    [--subsamples 4]        \   # K for K×K footprint subsampling
    [--skip-merge]          \   # stop after Step 1 (inspect per-scene zarrs)
    [--skip-pyramid]            # stop after Step 2 (inspect merged base)
```

---

## On-disk layout

```
output/
├── scenes/
│   ├── 0000_T29SND.zarr       # per-scene base level only
│   │   ├── cell_id            # int64 (M,)  NESTED-sorted
│   │   ├── values             # float32 (M, bands)
│   │   └── .zattrs            # base_nside, bands, source_url
│   ├── 0001_T29SPA.zarr
│   └── …
├── merge/
│   ├── r0_p0.zarr             # round 0, pair 0 (scenes 0+1 merged)
│   ├── r0_p1.zarr             # round 0, pair 1 (scenes 2+3 merged)
│   └── …
├── merged_base.zarr           # fully deduplicated base level
└── mosaic.zarr                # final pyramid
    ├── nside_262144/
    │   ├── cell_id            # int64  (N,)
    │   ├── values             # float32 (N, bands)
    │   └── parent_offsets     # int64  (12*nside_parent^2 + 1,)
    ├── nside_131072/
    └── … down to nside_128/
```

---

## Performance strategy

| Bottleneck | Strategy |
|---|---|
| Downloading + resampling N scenes | `dask.delayed` across N workers; scenes are independent |
| Memory during merge | Tree reduction: peak RAM = 2 × one scene per worker |
| Merge throughput | `numpy.lexsort` + boolean mask — no Python loops |
| Pyramid throughput | Vectorised `numpy.unique` + `bincount`; no loops |
| Worker startup overhead | `Transformer` and zarr store opened once per scene, not per batch |

**What is deliberately not done:**
- No within-scene spatial chunking — a single r20m scene (~30M pixels) fits comfortably in a single worker's RAM and processes in one loop.
- No numba/cython JIT — network I/O dominates scene processing time; extra build complexity is not justified.
- No cloud storage — local disk only, as agreed.

---

## Dependencies (`pyproject.toml`)

```toml
[project]
name = "sentinel2-zhealpix"
requires-python = ">=3.11"
dependencies = [
    "dask[distributed]",
    "zarr>=3",
    "healpy",
    "pyproj",
    "numpy",
]
```

Run with: `uv run python -m sentinel2_zhealpix.orchestrate --help`

---

## Disk space estimate

| Artifact | Size (20 scenes) |
|---|---|
| Per-scene zarrs (`scenes/`) | ~13 GB (20 × ~650 MB) |
| Merge intermediates (`merge/`) | ~13 GB peak (halves each round) |
| `merged_base.zarr` | ~5 GB |
| `mosaic.zarr` (full pyramid) | ~13 GB |
| **Total peak** | **~44 GB** |

After the pipeline completes, `scenes/` and `merge/` can be deleted to reclaim ~26 GB.
