# deck.gl-healpix-zarr — Design Spec

**Date:** 2026-04-27  
**Status:** Approved  
**Package:** `packages/deck.gl-healpix-zarr/` in `healpix-layers-deck.gl`

---

## Overview

A new reusable deck.gl layer package that loads HEALPix-indexed Zarr tile pyramids and renders them via `HealpixCellsLayer`.

The package integrates with deck.gl's `TileLayer` / `Tileset2D` infrastructure to get tile caching, request scheduling, AbortSignal cancellation, and best-available refinement (show cached parent tile while finer tiles load) for free.

---

## Package Structure

```
packages/deck.gl-healpix-zarr/
  src/
    index.ts                    # public exports
    healpix-zarr-tile-layer.ts  # HealpixZarrTileLayer
    healpix-tileset-2d.ts       # HealpixTileset2D
    cached-zarr-store.ts        # CachedZarrStore
    utils.ts                    # getNsideForZoom, clampToAvailable, etc.
    types.ts                    # HealpixTileIndex, HealpixZarrTileData, etc.
  test/
    healpix-tileset-2d.test.ts
    cached-zarr-store.test.ts
    utils.test.ts
    integration/
      healpix-zarr-tile-layer.test.ts
      fixtures/                 # small synthetic zarr store
  package.json
  tsconfig.json
  rollup.config.mjs
  README.md
```

**Public exports:**
- `HealpixZarrTileLayer` — consumer-facing CompositeLayer
- `HealpixTileset2D` — exported for testing and advanced reuse
- `CachedZarrStore` — zarr LRU chunk store, usable standalone
- Types: `HealpixTileIndex`, `HealpixZarrTileData`, `HealpixZarrTileLayerProps`

**Peer dependencies:** `@deck.gl/core`, `@deck.gl/geo-layers`, `@deck.gl/layers`, `zarrita`, `healpix-ts`  
**Dependencies:** `healpix-layers-deck.gl` (for `HealpixCellsLayer`, `makeColorMap`)

---

## Zarr Data Format

This section is the authoritative spec for what the Python generation scripts must produce and what `HealpixZarrTileLayer` expects to consume.

### Store Layout (Zarr v3)

```
{store_root}/
  .zattrs:
    base_nside: int        # finest resolution level in the pyramid
    min_nside:  int        # coarsest resolution level
    bands:      string[]   # e.g. ["B02", "B03", "B04", "B08"]

  nside_{N}/               # one group per pyramid level
                           # N iterates: min_nside, min_nside×2, ..., base_nside
    .zattrs:
      nside_parent: int    # nside used for tile indexing (typically N / 4)

    cell_id:               # float64[num_rows]
                           # NESTED HEALPix cell index at nside N

    values:                # float32[num_rows, num_bands]
                           # one row per cell; bands in same order as root .zattrs.bands

    parent_offsets:        # int64[12 * nside_parent² + 1]
                           # CSR index over parent cells (NESTED, at nside_parent)
                           # parent_offsets[p]   = rowStart for parent p
                           # parent_offsets[p+1] = rowEnd   for parent p  (exclusive)
                           # parent_offsets[0]   = 0  (always)
                           # parent_offsets[-1]  = num_rows  (always)
                           # unoccupied parent:  parent_offsets[p] == parent_offsets[p+1]
```

### Invariants

- `cell_id` uses the **NESTED** scheme at the nside of the group.
- `parent_offsets` is dense over `[0, 12 * nside_parent²]`. Unoccupied parents have an empty range (`offsets[p] == offsets[p+1]`); no sparse index is needed.
- Rows within a parent's range need not be sorted.
- `nside_parent` divides `N` by a power of 2 (expected ratio: 4).
- There is **no NaN padding** in `values`. The `parent_offsets` CSR gives exact row ranges — only occupied cells are stored.

### Tile Load Path

For a tile at `(nside, parentCell)`:

```
1. zarr.get(parent_offsets, [slice(p, p+2)])   → BigInt64Array of length 2
2. rowStart = Number(offsets[0])
   rowEnd   = Number(offsets[1])
   if rowStart == rowEnd → empty tile, return null

3. zarr.get(cell_id, [slice(rowStart, rowEnd)]) → Float64Array
4. zarr.get(values,  [slice(rowStart, rowEnd), slice(0, numBands)]) → Float32Array

5. return { nside, cellIds, values, bands }
```

No NaN filtering is required. AbortSignal from `Tileset2D` is passed through zarr fetches to cancel out-of-view tiles.

### Recommended Chunking

- `cell_id` and `values`: chunk rows at 1024–4096 (power of 2). Align chunk boundaries with parent cell boundaries where possible to minimise cross-chunk reads.
- `parent_offsets`: single chunk (small array, always fully read on first access).

---

## Architecture

### Data Flow

```
viewport change
  → HealpixTileset2D.getTileIndices(viewport)
      zoom + zoomOffset → nside
      queryBoxInclusiveNest(nsideParent, bounds) → parent cells
      → [{x: parentCell, y:0, z: log2(nside)}, ...]

  → Tileset2D schedules getTileData for new tiles
    (handles concurrency, AbortSignal, LRU eviction)

  → HealpixZarrTileLayer.getTileData({ index, signal })
      open CachedZarrStore (cached per url)
      open zarr group handle (cached per url+nside)
      parent_offsets → rowRange
      cellIdArr + valueArr slice → { nside, cellIds, values, bands }

  → HealpixZarrTileLayer.renderSubLayers({ data, tile })
      → new HealpixCellsLayer per loaded tile
```

---

## `HealpixTileset2D`

Subclass of `Tileset2D` (`@deck.gl/geo-layers`).

### Tile Index

```typescript
interface HealpixTileIndex {
  x: number;  // parent cell (NESTED) at nside_parent
  y: 0;       // unused
  z: number;  // log2(nside) — the data nside, not deck.gl zoom
}
```

### Overridden Methods

| Method | Implementation |
|---|---|
| `getTileIndices(viewport)` | zoom → nside → nsideParent → `queryBoxInclusiveNest` → `[{x, y:0, z}]`; returns `[]` until metadata loaded |
| `getTileId({x, z})` | `"${z}-${x}"` |
| `getTileZoom({z})` | `z` |
| `getTileMetadata({x, z})` | `{ bbox: cornersNestLonLat(2^z, x), nside: 2^z }` |
| `getParentIndex({x, z})` | `{ x: Math.floor(x / 4), y: 0, z: z - 1 }` |

`getParentIndex` uses NESTED semantics: the parent of cell `C` at nside `N` is `floor(C / 4)` at nside `N/2`. Used by the `best-available` refinement strategy to find a cached coarser tile as a placeholder while finer tiles load.

### nside Selection

No hardcoded table. nside is derived from viewport zoom:

```typescript
const nsidePower = Math.round(viewport.zoom + this.opts.zoomOffset);
const nside = clampToAvailable(2 ** nsidePower, availableNsides);
```

`zoomOffset` (default: `5`) is a first-class layer prop — consumers tune it for their data density. `clampToAvailable` picks the nearest nside present in the zarr pyramid, biasing coarser when an exact match is absent.

### Metadata Injection

`getTileIndices` returns `[]` until `availableNsides` and `nsideParentMap` are set. `HealpixZarrTileLayer` calls `tileset.setOptions({ availableNsides, nsideParentMap })` after async zarr bootstrap, then `this.setNeedsUpdate()`.

---

## `HealpixZarrTileLayer`

Extends `TileLayer` with `TilesetClass: HealpixTileset2D`.

### Props

```typescript
type HealpixZarrTileLayerProps = TileLayerProps & {
  url: string;            // zarr store root URL
  zoomOffset?: number;    // nside tuning; default 5
  // forwarded to each HealpixCellsLayer sub-layer:
  colorMap?: Uint8Array;  // 256×4 RGBA LUT (from makeColorMap)
  min?: number;
  max?: number;
  dimensions?: 1 | 2 | 3 | 4;
}
```

### Lifecycle

**`initializeState`** — opens zarr root via `CachedZarrStore`, reads root attrs (`base_nside`, `min_nside`, `bands`), iterates nside levels to build `nsideParentMap: Map<number, number>`, injects into `HealpixTileset2D`, calls `setNeedsUpdate()`.

**`getTileData({ index, signal })`** — `index.x` = parentCell, `index.z` = log2(nside):
1. Open group handle (cached per `url:nside`)
2. Fetch `parent_offsets[p:p+2]` → row range
3. If empty range → return `null`
4. Fetch `cell_id[rowStart:rowEnd]` and `values[rowStart:rowEnd, :]` in parallel
5. Return `{ nside, cellIds, values, bands }`

**`renderSubLayers({ data, tile })`** — returns `null` for null data; otherwise:

```typescript
new HealpixCellsLayer({
  id: `tile-${tile.id}`,
  nside: data.nside,
  cellIds: data.cellIds,
  values: data.values,
  colorMap,
  min,
  max,
  dimensions,
})
```

---

## `CachedZarrStore`

LRU in-memory cache wrapping zarrita's `FetchStore`. Operates at the zarr **chunk level**, complementing `Tileset2D`'s tile-level cache.

- Prevents duplicate HTTP requests when multiple tiles concurrently read the same zarr chunk
- Serves chunks from memory when `Tileset2D` LRU-evicts a tile and it's later re-requested
- Drop-in replacement for `zarrita.FetchStore`

Extracted from `healpix-explorer/app/pages/zarr/zarr-cached-store.ts` with minor cleanup.

---

## Testing

### Unit Tests

- **`HealpixTileset2D`** — `getTileIndices` returns correct parent cells for a given viewport and zoom; `getParentIndex` returns correct NESTED parent (`x>>2, z-1`); `getTileId` produces unique keys; returns `[]` before metadata loaded
- **`CachedZarrStore`** — cache hit on second fetch; deduplicates concurrent requests to the same chunk URL; LRU eviction at capacity
- **`utils`** — `getNsideForZoom` with various zoom/offset combos; `clampToAvailable` boundary cases

### Integration Test

A small synthetic zarr fixture committed under `test/fixtures/` (2 nside levels, 3 parent cells, 2 bands). `HealpixZarrTileLayer.getTileData` loads the fixture and asserts correct `cellIds` shape and `values` range. The fixture is produced by a small Python script (also committed) so the round-trip — Python writes, TypeScript reads — is verifiable.