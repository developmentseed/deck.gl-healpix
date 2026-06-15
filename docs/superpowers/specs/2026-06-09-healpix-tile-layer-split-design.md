# Design: Split `HealpixZarrTileLayer` into `HealpixTileLayer` + `HealpixZarrTileLayer`

## Summary

Extract a new `@developmentseed/deck.gl-healpix-tile` package containing a generic `HealpixTileLayer` that handles HEALPix tile management and rendering. `HealpixZarrTileLayer` in `deck.gl-healpix-zarr` extends it, adding only Zarr-specific data loading.

---

## Package Structure

### New package: `packages/deck.gl-healpix-tile`

Name: `@developmentseed/deck.gl-healpix-tile`

Contains everything from `deck.gl-healpix-zarr` that is not Zarr-specific:

| File | Source |
|---|---|
| `healpix-tile-layer.ts` | New file, split from `healpix-zarr-tile-layer.ts` |
| `healpix-tileset-2d.ts` | Moved from `deck.gl-healpix-zarr` |
| `sort-by-distance.ts` | Moved from `deck.gl-healpix-zarr` |
| `tile-debug-layers.ts` | Moved from `deck.gl-healpix-zarr` |
| `utils.ts` | Moved from `deck.gl-healpix-zarr` |
| `types.ts` | `HealpixTileIndex` + `HealpixTileData` (see Renames section) |

Dependencies: `@deck.gl/core`, `@deck.gl/geo-layers`, `@developmentseed/deck.gl-healpix`, `healpix-ts`, `@luma.gl/shadertools`.

### Updated package: `packages/deck.gl-healpix-zarr`

Retains only Zarr-specific files:

| File | Action |
|---|---|
| `healpix-zarr-tile-layer.ts` | Slimmed — extends `HealpixTileLayer` |
| `zarr-pyramid.ts` | Unchanged |
| `cached-zarr-store.ts` | Unchanged |
| `types.ts` | Only Zarr-specific types remain (currently none after renames) |

Gains dependency on `@developmentseed/deck.gl-healpix-tile`.

---

## Renames

| Old name | New name | New location |
|---|---|---|
| `HealpixZarrTileData` | `HealpixTileData` | `deck.gl-healpix-tile` |
| `HealpixZarrLayerStats` | `HealpixTileLayerStats` | `deck.gl-healpix-tile` |

---

## `HealpixTileLayer`

### Props

```typescript
type _HealpixTileLayerProps = {
  /**
   * Called for each tile to fetch its data. Return null to render nothing for
   * that tile.
   */
  getTileData: (tile: { index: HealpixTileIndex; signal?: AbortSignal }) => Promise<HealpixTileData | null>;
  /** ColorMap LUT: exactly 256 × 4 = 1024 RGBA bytes. */
  colorMap?: Uint8Array;
  filterMin?: number;
  filterMax?: number;
  rescaleMin?: number;
  rescaleMax?: number;
  colorMode?: number;
  shaderModules?: ShaderModule[];
  debugTiles?: boolean;
  onStats?: (stats: HealpixTileLayerStats) => void;
};

export type HealpixTileLayerProps = _HealpixTileLayerProps &
  Omit<TileLayerProps<HealpixTileData | null>, 'getTileData'>;
```

`TilesetClass` defaults to `HealpixTileset2D` (same as current layer).

`availableNsides` and `parentLevels` are **not** props on `HealpixTileLayer` — they are Zarr-metadata concepts owned entirely by `HealpixZarrTileLayer` via `_getTilesetOptions` override.

### State

```typescript
declare state: Omit<TileLayer['state'], 'tileset'> & {
  tileset: HealpixTileset2D | null;
};
```

### Public method: `refreshTileData`

```typescript
refreshTileData(filter?: (index: HealpixTileIndex) => boolean): void
```

Re-invokes `getTileData` for tiles matching the filter predicate. With no argument, all tiles are refreshed. The layer iterates the tileset tile cache, applies the predicate to each tile's `HealpixTileIndex`, and triggers a reload for matching tiles.

### Private methods moved from `HealpixZarrTileLayer`

- `renderSubLayers` — creates `HealpixCellsLayer` from `HealpixTileData`, unchanged logic
- `_emitStats` — emits `HealpixTileLayerStats`, unchanged logic

### `HealpixTileLayerStats`

```typescript
export type HealpixTileLayerStats = {
  nside: number;
  nsideParent: number;
  tilesRendered: number;
  cellsRendered: number;
};
```

---

## `HealpixZarrTileLayer`

Extends `HealpixTileLayer`. Becomes thin.

### Props (Zarr-specific only)

```typescript
type _HealpixZarrTileLayerProps = {
  url: string;
  bands: string[] | null;
  onMetadata?: (meta: ZarrPyramidMetadata, root: zarr.Group<CachedZarrStore>) => void;
};

export type HealpixZarrTileLayerProps = _HealpixZarrTileLayerProps &
  Omit<HealpixTileLayerProps, 'getTileData'>;
```

All rendering props (`colorMap`, `filterMin/Max`, `rescaleMin/Max`, `colorMode`, `shaderModules`, `debugTiles`, `onStats`) are inherited from `HealpixTileLayer` and no longer re-declared here.

### State

```typescript
declare state: HealpixTileLayer['state'] & {
  availableNsides: number[];
  parentLevels: number;
};
```

### Methods kept

- `getTileData` override — calls `getGroupHandle` + `loadTileFromGroup` (unchanged logic)
- `_loadMetadata` — populates `state.availableNsides` and `state.parentLevels` (unchanged logic)
- `_getTilesetOptions` override — reads `availableNsides`/`parentLevels` from state
- `updateState` — bands-change detection that triggers tile reload (unchanged logic)

### Methods removed

- `renderSubLayers` — now in `HealpixTileLayer`
- `_emitStats` — now in `HealpixTileLayer`

---

## Tests

- `healpix-zarr-tile-layer.test.ts` splits: `HealpixTileLayer`-specific tests move to `deck.gl-healpix-tile`; Zarr-specific tests stay in `deck.gl-healpix-zarr`.
- `__mocks__/` in `deck.gl-healpix-zarr` is reviewed — any mocks needed by the new package's tests are duplicated or shared.

---

## Public API / Exports

### `deck.gl-healpix-tile` exports

```typescript
export { HealpixTileLayer } from './healpix-tile-layer';
export type { HealpixTileLayerProps, HealpixTileLayerStats } from './healpix-tile-layer';
export { HealpixTileset2D } from './healpix-tileset-2d';
export type { HealpixTileset2DOptions } from './healpix-tileset-2d';
export type { HealpixTileIndex, HealpixTileData } from './types';
export { clampToAvailable, getNsideForZoom, rowRangeFromOffsetPair } from './utils';
export type { ParentRowRange } from './utils';
```

### `deck.gl-healpix-zarr` exports

Removes types that moved. Adds re-export of `HealpixTileLayer` and related types from `deck.gl-healpix-tile` for consumers who import everything from the zarr package (backwards-compat consideration — see open question below).

---

## Decisions

1. **Backwards compatibility**: No re-exports of `HealpixTileLayer` or `HealpixTileData` from `deck.gl-healpix-zarr`. The package is pre-1.0 so breaking export changes are acceptable. Consumers that need the tile layer or tile data types should depend on `deck.gl-healpix-tile` directly.

2. **`HealpixZarrLayerStats`**: Removed entirely. No type alias. Consumers use `HealpixTileLayerStats` from `deck.gl-healpix-tile`.
