# sentinel2-zhealpix

Converts Sentinel-2 L2A reflectance zarrs into a single merged HEALPix `parent_offsets` pyramid on local disk, suitable for rendering with the deck.gl HEALPix layer.

## Requirements

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) (handles all dependencies automatically)

## Pipeline overview

Four stages, each runnable on its own:

1. **`download`** — mirror `measurements/reflectance/<group>` into a local raw zarr under `--out-dir/raw/`.
2. **`healpix`** — read each raw zarr and write a base-level HEALPix scene zarr under `--out-dir/scenes/`.
3. **`merge`** — tree-merge scene zarrs into `--out-dir/merged_base.zarr` (first scene wins on overlap).
4. **`pyramid`** — build multi-resolution `parent_offsets` mosaic from `merged_base.zarr` into `--out-dir/mosaic.zarr`.

`run-all` chains all four and skips stages whose outputs already exist on disk.

When **`run-all --workers 1`** is used, the pipeline runs in-process without starting a Dask `LocalCluster` (fine for tests and small jobs). Use **`--workers` ≥ 2** for parallel download/healpix/merge inside `run-all`.

## Quick start (full pipeline)

```bash
cd sentinel2-zhealpix

uv run python -m sentinel2_zhealpix run-all \
    --urls https://example.com/S2B_MSIL2A_20260101T110351_T29SND.zarr \
    --out-dir ./output

uv run python -m sentinel2_zhealpix run-all \
    --urls-file urls.txt \
    --out-dir ./output
```

Final artefact: `./output/mosaic.zarr`. Re-running with the same `--out-dir` is idempotent.

## Individual stages

```bash
uv run python -m sentinel2_zhealpix download \
    --urls-file urls.txt --out-dir ./output

uv run python -m sentinel2_zhealpix healpix \
    --out-dir ./output

uv run python -m sentinel2_zhealpix merge \
    --out-dir ./output

uv run python -m sentinel2_zhealpix pyramid \
    --out-dir ./output
```

### Reading inputs from other directories

| Stage | Flag | Default |
|---|---|---|
| `healpix` | `--raw-dir DIR` | `--out-dir/raw` |
| `merge` | `--scenes-dir DIR` | `--out-dir/scenes` |
| `pyramid` | `--merged-base PATH` | `--out-dir/merged_base.zarr` |

`run-all` only uses the conventional paths under `--out-dir` (no overrides).

Example:

```bash
python -m sentinel2_zhealpix healpix --raw-dir /shared/raw --out-dir ./run-001
python -m sentinel2_zhealpix merge --out-dir ./run-001
python -m sentinel2_zhealpix pyramid --out-dir ./run-001
```

## Flags (reference)

```
--urls / --urls-file     Sentinel-2 product URLs                 [download, run-all]
--out-dir               Root output directory                    [all]
--raw-dir               Override raw input directory             [healpix]
--scenes-dir            Override scenes input directory          [merge]
--merged-base           Override merged_base.zarr path          [pyramid]
--workers               Dask workers (default: cpu_count-1).    [download, healpix, merge, run-all]
                        Use 1 to skip LocalCluster on standalone commands,
                        or sequential run-all (see above).
--reflectance-group     r10m | r20m | r60m (default r20m)       [download, healpix, run-all]
--base-nside            Override HEALPix resolution             [healpix, run-all]
--subsamples            K×K footprint subsampling               [healpix, run-all]
--min-nside             Coarsest pyramid level                   [pyramid, run-all]
--parent-levels         Doubling steps between pyramid levels    [pyramid, run-all]
```

## Output layout

```
output/
├── raw/
├── scenes/
├── merge/
├── merged_base.zarr
└── mosaic.zarr
```

Delete `raw/`, `scenes/`, and `merge/` after success if you only need `mosaic.zarr`.

## Resuming / checkpoints

Re-running `run-all` skips finished stages. If you change `--reflectance-group`, delete `raw/` first.

## Disk budget (order of magnitude, r20m, ~20 scenes)

Rough totals rise substantially once download persists raw mirrors alongside scenes — budget **`raw/` + `scenes/` + merge intermediates + `merged_base.zarr` + `mosaic.zarr`**.

## Tests

```bash
cd sentinel2-zhealpix
uv run pytest tests/ -v
```
