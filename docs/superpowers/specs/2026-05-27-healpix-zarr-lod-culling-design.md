# HEALPix Zarr Tile LOD Culling

**Date:** 2026-05-27  
**Updated:** 2026-06-02  
**Status:** Implemented  
**Package:** `deck.gl-healpix-zarr`

---

## Problem

When the map is tilted (WebMercator `MapView` with pitch > 0), the far side of the map is still visible. `HealpixTileset2D.getTileIndices` returns all visible partition tiles at the same data nside — the nside derived from `viewport.zoom`. Far tiles occupy a tiny fraction of screen pixels but are loaded at full resolution, wasting bandwidth and GPU memory.

---

## Goal

Far tiles should load at a lower nside (coarser resolution) based on their vertical position on screen. Near tiles are unaffected. At pitch = 0 the behaviour is identical to today.

---

## Scope

- **In scope:** per-tile LOD in `HealpixTileset2D.getTileIndices` for WebMercator flat-map views with pitch.
- **Out of scope:** GlobeView support, explicit `maxTiles` budget, user-exposed props.

---

## Design

### Principle

In a pitched flat-map viewport, screen-Y is a reliable proxy for tile distance: tiles near the top of the screen are far away (low detail); tiles near the bottom are close (full detail). The LOD reduction is proportional to pitch — at pitch = 0 all tiles receive the base nside unchanged.

### Algorithm

**Step 1 — Query base partition cells (unchanged)**

```
base_nside           = nsideForZoom(viewport.zoom)
base_partition_nside = partitionNside(base_nside)
candidates           = queryBoxInclusiveNest(base_partition_nside, viewport.getBounds())
```

**Step 2 — Per-tile LOD (`computePerTileLOD`)**

For each candidate partition cell `x_p`:

1. `[lon, lat] = pix2LonLatNest(base_partition_nside, x_p)`
2. `[_, sy1] = viewport.project([lon, lat])`
3. `normalizedY = sy1 / viewport.height`  (0 = top of screen, 1 = bottom)
4. Look up `bandFraction` from the LOD band table using `normalizedY`:

   | normalizedY      | bandFraction |
   |------------------|-------------|
   | ≤ 0.2            | 0.4         |
   | ≤ 0.4            | 0.8         |
   | ≤ 1.0 (or above) | 1.0         |

5. `pitchFactor = clamp(viewport.pitch / 60, 0, 1)`
6. `fraction = 1.0 − (1.0 − bandFraction) × pitchFactor`
7. `target_nside = round(base_nside × fraction)`
8. `N_d = clampToAvailable(max(target_nside, min(availableNsides)), availableNsides)`

At pitch = 0: `pitchFactor = 0` → `fraction = 1.0` → `N_d = base_nside` (current behaviour).  
At pitch = 60 with a tile at `normalizedY = 0.1`: `fraction = 0.4` → `N_d` steps down to the largest available nside ≤ `round(base_nside × 0.4)`.

Note: tiles behind the horizon (`sy1 < 0`) have `normalizedY < 0`, which falls into the top band and receives the same treatment as the most distant visible tiles. This avoids artifacts from large coarse tiles bleeding into the visible area.

**Step 3 — Remap `x` to the new partition nside**

```
P_d        = partitionNside(N_d)
level_diff = log2(P_base) − log2(P_d)   // integer, ≥ 0
x_d        = floor(x_p / 4^level_diff)  // HEALPix NESTED ancestor
tile index = { x: x_d, y: nside2order(P_d), z: nside2order(N_d) }
```

**Step 4 — Deduplicate and sort**

Multiple base-partition cells can collapse to the same lower-nside tile; deduplicate by `getTileId(index)`. Then sort by distance from viewport centre (unchanged).

**Graceful degradation**

- If `viewport.project` is absent: skip LOD, return all tiles at `base_nside`.
- If `viewport.height` is absent: skip LOD, return all tiles at `base_nside`.

---

## Changes

### `packages/deck.gl-healpix-zarr/src/sort-by-distance.ts`

`sortTileIndicesByViewportCenter` derives the per-tile partition nside from `index.y` (which stores `nside2order(P_d)`):

```ts
const [lon, lat] = pix2LonLatNest(1 << index.y, index.x);
```

The `partitionNside` parameter is removed from the function signature.

### `packages/deck.gl-healpix-zarr/src/healpix-tileset-2d.ts`

1. **Widen the `viewport` parameter type** in `getTileIndices` and `computePerTileLOD`:

   ```ts
   viewport: {
     zoom: number;
     height?: number;
     pitch?: number;
     getBounds(): [number, number, number, number];
     project?(xy: number[]): number[];
   }
   ```

2. **Extract `computePerTileLOD`** — pure helper, exported for testing. Implements Steps 2–3 above.

3. **Replace the `indices` map** in `getTileIndices` with the LOD map → deduplicate → sort pipeline.

### `packages/deck.gl-healpix-zarr/src/healpix-tileset-2d.test.ts`

Test cases for `computePerTileLOD`:

| Scenario | Expected |
|---|---|
| `project` absent | `z = nside2order(base_nside)` (fallback) |
| `height` absent | `z = nside2order(base_nside)` (fallback) |
| High normalizedY, pitch=60 (near tile) | `z = nside2order(base_nside)` — top LOD band gives fraction=1.0 |
| Low normalizedY, pitch=60 (far tile) | `z < nside2order(base_nside)` — steps to lower available nside |
| Any normalizedY, pitch=0 | `z = nside2order(base_nside)` — pitchFactor=0 suppresses all reduction |
| All tiles in top band, availableNsides=[4,128] | 12 deduplicated tiles at z=2 (nside=4) |

---

## Invariants preserved

- `getTileIndices` still returns only tiles whose partition cells overlap the viewport bbox.
- Tiles are still sorted nearest-first.
- `base_nside` is still the maximum nside returned; LOD can only reduce, never increase.
- No props are added or changed on `HealpixZarrTileLayer`.
- The `getTileData` / Zarr loading path is unchanged — it already handles any `z` value.
