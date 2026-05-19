# HEALPix Pyramid Zarr — Store Specification

**Version:** 1.0  
**Zarr format:** v3  
**Status:** Draft

---

## Overview

A HEALPix Pyramid Zarr store is a Zarr v3 group that encodes geospatial raster data in the HEALPix NESTED pixel scheme across multiple resolution levels. Each level holds a sparse set of cells (only cells with data are stored), indexed by a CSR-style `parent_offsets` array that allows efficient tile-based access.

The store is designed to be generic: it can hold a single scalar variable (e.g. elevation, temperature) or multiple co-registered variables (e.g. satellite spectral bands), all sharing the same set of cell IDs at each resolution level.

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

All keys are **required** unless explicitly marked optional.

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

One group exists for every power-of-two N in `[min_nside, base_nside]`.

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

Each element is the HEALPix NESTED cell index at resolution `nside`. Values are unique within a level. The array is sorted in ascending order of `parent_offsets` (i.e. cells belonging to the same parent are contiguous).

### `parent_offsets`

| Property | Value |
|----------|-------|
| Shape | `[n_parents + 1]` |
| dtype | `uint64` (values are always non-negative; `int64` is also accepted by readers) |
| Encoding | little-endian bytes + zstd compression |
| Fill value | `0` |

CSR-style index array. For parent cell `p`, the data cells belonging to it occupy rows `parent_offsets[p] : parent_offsets[p+1]` in `cell_id` and every `bands/<name>` array. An empty parent cell has `parent_offsets[p] == parent_offsets[p+1]`.

### `bands/<band_name>`

One array per entry in `root.attrs.bands`. The name must exactly match the corresponding entry in the `bands` list.

| Property | Value |
|----------|-------|
| Shape | `[npix]` |
| dtype | `float32` |
| Encoding | little-endian bytes + zstd compression |
| Fill value | `0.0` |

The i-th element corresponds to the i-th element of `cell_id`. All band arrays within a level have the same length (`npix`).

---

## Single-variable stores

A store with a single variable is valid and identical in layout to a multi-band store. The root `bands` attribute contains exactly one name (the name is arbitrary but should be descriptive):

```json
{ "bands": ["elevation"] }
```

The store then contains `bands/elevation` at every level, and callers receive `meta.bands === ["elevation"]` from `onMetadata`.

---

## Naming conventions

- **Band names** should be lowercase ASCII, using underscores for spaces. No slashes or dots. Examples: `b01`, `b8a`, `elevation`, `ndvi`, `red`.
- **Level directory names** are `nside_<N>` where `<N>` is the decimal integer nside value with no zero-padding.

---

## Conformance

A store is conformant if:

1. Root `zarr.json` contains all required attributes with the correct types.
2. A group `nside_<N>` exists for every power-of-two N in `[min_nside, base_nside]`.
3. Each level group contains `cell_id`, `parent_offsets`, and `bands/<name>` for every name in root `bands`, with the shapes and dtypes specified above.
4. `parent_offsets` length equals `12 * nside_parent^2 + 1`.
5. All `bands/<name>` arrays at a level have the same length as `cell_id`.
