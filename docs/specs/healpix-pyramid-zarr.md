# HEALPix Pyramid Zarr store specification

**Version:** 1.0  
**Zarr format:** v3  
**Status:** Draft

---

## Overview

A HEALPix Pyramid Zarr store is a Zarr v3 group with geospatial raster data in HEALPix NESTED order at one or more resolution levels. Each level is sparse: only cells that contain data are stored. Cells are indexed with a CSR-style `parent_offsets` array so a reader can load one parent partition at a time (the usual tile access pattern).

The same layout works for one variable (elevation, temperature) or several variables on the same cells (spectral bands). All bands at a level share the same `cell_id` ordering.

---

## Top-level layout

```
<store>.zarr/
  zarr.json                 ← root group metadata (see §Root attributes)
  nside_<N>/                ← one group per available resolution level
    zarr.json               ← level group metadata (see §Level attributes)
    cell_id                 ← Zarr array, int64, shape [npix]
    parent_offsets          ← Zarr array, uint64 (values always non-negative), shape [n_parents + 1]
    bands/                  ← group containing one sub-array per variable
      zarr.json             ← empty attributes, node_type: group
      <band_name>/          ← Zarr array, float32, shape [npix]
        zarr.json
      ...
  nside_<M>/
    ...
```

All keys are required unless marked optional.

---

## Root group attributes (`zarr.json` at store root)

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `base_nside` | integer (power of 2) | yes | Finest available resolution level. |
| `min_nside` | integer (power of 2) | yes | Coarsest available resolution level. `min_nside <= base_nside`. |
| `bands` | string[] | yes | Ordered list of variable names present in every `bands/` sub-group. Order determines column index when values are interleaved. Must be non-empty. |
| `parent_levels` | integer | yes | Number of HEALPix levels between data nside and partition nside at each level: `nside_parent = max(1, nside / 2^parent_levels)`. Must be consistent with every level's `nside_parent` attribute. |
| `created_at` | ISO 8601 string | no | Timestamp of store creation. |
| `source_urls` | string[] | no | Provenance: upstream URLs this store was derived from. |

### Minimal valid example

```json
{
  "attributes": {
    "base_nside": 32768,
    "min_nside": 128,
    "bands": ["value"],
    "parent_levels": 6
  },
  "zarr_format": 3,
  "node_type": "group"
}
```

---

## Resolution level group attributes (`nside_<N>/zarr.json`)

There is one group for each power-of-two N in `[min_nside, base_nside]`.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `nside` | integer | yes | HEALPix nside of this level. Must equal N in the directory name. |
| `nside_parent` | integer | yes | nside of the partition grid used by `parent_offsets`. `nside_parent = max(1, nside / 2^parent_levels)`. |
| `children_per_parent` | integer | yes | `(nside / nside_parent)^2`. Number of data-level cells that can fall under one parent cell. |
| `n_cells` | integer | yes | Actual number of data cells stored at this level (`npix`). Equals `cell_id.shape[0]`. |
| `n_parents` | integer | yes | Total number of parent-grid cells (`12 * nside_parent^2`). Equals `parent_offsets.shape[0] - 1`. |

### Example

```json
{
  "attributes": {
    "nside": 1024,
    "nside_parent": 16,
    "children_per_parent": 4096,
    "n_cells": 1195,
    "n_parents": 3072
  },
  "zarr_format": 3,
  "node_type": "group"
}
```

---

## Arrays

### `cell_id`

| Property | Value |
|----------|-------|
| Shape | `[npix]` |
| dtype | `int64` |
| Encoding | little-endian bytes + zstd compression |
| Fill value | `0` |

Each element is the HEALPix NESTED cell index at resolution `nside`. Values are unique within a level. The array is sorted by `parent_offsets`: cells under the same parent are contiguous.

### `parent_offsets`

| Property | Value |
|----------|-------|
| Shape | `[n_parents + 1]` |
| dtype | `uint64` (values are always non-negative; `int64` is also accepted by readers) |
| Encoding | little-endian bytes + zstd compression |
| Fill value | `0` |

CSR-style index. For parent cell `p`, data rows are `parent_offsets[p] : parent_offsets[p+1]` in `cell_id` and in each `bands/<name>` array. An empty parent has `parent_offsets[p] == parent_offsets[p+1]`.

#### Chunking `parent_offsets`

`parent_offsets` is dense over the full parent grid: length `12 * nside_parent² + 1`. At coarse levels that is small; at fine levels it can be millions of entries (tens of megabytes uncompressed). The tile layer only needs two values per visible tile: `parent_offsets[p]` and `parent_offsets[p+1]`, to get the row range for parent `p`.

Over HTTP, Zarr v3 reads by chunk. The byte range comes from the chunk that contains the sliced indices, not from how narrow the slice is:

- One chunk for the whole array means every tile load pulls the full CSR index. Pan and zoom will re-download it.
- Chunks that are too large (e.g. 1M entries, about 8 MB for `uint64`) still mean a request for `p` and `p+1` downloads the whole chunk covering `p`, not just the 16 bytes you need.

Chunk `parent_offsets` along its only dimension into moderately sized pieces. **4096** entries (32 KB for `uint64`) is a reasonable default: a `slice(p, p+1)` read touches at most one chunk, and metadata overhead stays low.

Chunk `cell_id` and `bands/<name>` on the row dimension as well.

#### Reader load sequence

For each visible parent cell `p` at a level, conformant readers follow three steps (see `loadTileFromGroup` in `@developmentseed/deck.gl-healpix-zarr`):

1. **Row range lookup** — read two consecutive CSR entries:

   ```
   zarr.get(parent_offsets, [slice(p, p + 2)])
   ```

   Over HTTP this is a range read on the chunk(s) for indices `p` and `p+1`. With 4096-entry chunks, that is at most one chunk (~32 KB). Set `rowStart = offsets[0]`, `rowEnd = offsets[1]`. If `rowStart >= rowEnd`, the parent tile is empty; stop.

2. **Cell IDs** — sparse rows for that parent:

   ```
   zarr.get(cell_id, [slice(rowStart, rowEnd)])
   ```

3. **Band values** — same row slice on each requested band:

   ```
   zarr.get(bands/<name>, [slice(rowStart, rowEnd)])   # for each selected band
   ```

Steps 2 and 3 can run in parallel after the range is known. Because `cell_id` and band arrays are sorted by parent, all rows for parent `p` are contiguous. Each step is one contiguous slice (it may span several row chunks, but not the full `npix` array).


### `bands/<band_name>`

One array per name in `root.attrs.bands`. The directory name must match the entry in the `bands` list.

| Property | Value |
|----------|-------|
| Shape | `[npix]` |
| dtype | `float32` |
| Encoding | little-endian bytes + zstd compression |
| Fill value | `0.0` |

Element `i` matches element `i` of `cell_id`. Every band array at a level has length `npix`.

---

## Single-variable stores

A one-band store uses the same layout as a multi-band store. Root `bands` has one name (your choice, but make it descriptive):

```json
{ "bands": ["elevation"] }
```

Every level then has `bands/elevation`, and `onMetadata` reports `meta.bands === ["elevation"]`.

---

## Naming conventions

- Band names: lowercase ASCII, underscores for spaces. No slashes or dots. Examples: `b01`, `b8a`, `elevation`, `ndvi`, `red`.
- Level directories: `nside_<N>` where `<N>` is the decimal nside with no zero-padding.

---

## Conformance

A store is conformant if:

1. Root `zarr.json` has all required attributes with the correct types.
2. A group `nside_<N>` exists for every power-of-two N in `[min_nside, base_nside]`.
3. Each level has `cell_id`, `parent_offsets`, and `bands/<name>` for every name in root `bands`, with the shapes and dtypes above.
4. `parent_offsets` length is `12 * nside_parent^2 + 1`.
5. All `bands/<name>` arrays at a level match `cell_id` length.
6. `parent_offsets` is chunked on its sole dimension. A single chunk is only acceptable when the array is smaller than one chunk.
