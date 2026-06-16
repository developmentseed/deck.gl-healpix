# @developmentseed/deck.gl-healpix-tile

A deck.gl layer for rendering HEALPix cell data. Handles tile management and rendering; data loading is supplied by the caller via `getTileData`.

## Installation

```bash
npm install @developmentseed/deck.gl-healpix-tile
```

Peer dependencies: `@deck.gl/core`, `@deck.gl/geo-layers`, `@deck.gl/layers`, `@luma.gl/core`, `@luma.gl/engine`, `@luma.gl/shadertools`.

## Usage

```typescript
import {
  HealpixTileLayer,
  type HealpixTileData,
  type HealpixTileIndex,
} from '@developmentseed/deck.gl-healpix-tile';

const layer = new HealpixTileLayer({
  getTileData: async ({ index, signal }) => {
    const data = await fetchMyData(index, signal);
    return data; // HealpixTileData | null
  },
  colorMode: HEALPIX_COLOR_MODE_RGB,
  bands: ['r', 'g', 'b'],
});
```

### `getTileData`

```typescript
getTileData: (tile: {
  index: HealpixTileIndex;  // { x: parentCell, y: partitionOrder, z: dataOrder }
  signal?: AbortSignal;
}) => Promise<HealpixTileData | null>
```

Return `null` to render nothing for the tile. The tile index convention is:

| field | meaning |
|-------|---------|
| `z` | `log2(nside)` for the data order |
| `y` | `log2(nside_partition)` — partition order |
| `x` | parent cell index at `nside_partition` (NESTED) |

Tile ids are formatted `z-y-x`.

### `HealpixTileData`

```typescript
type HealpixTileData = {
  nside: number;
  cellIds: Float64Array;   // HEALPix cell IDs (NESTED), one per pixel
  values: Float32Array;    // interleaved band values: [b0_p0, b1_p0, …, b0_p1, …]
  bands: string[];         // band names in value-column order
};
```

### Props

| prop | type | default | description |
|------|------|---------|-------------|
| `getTileData` | `function` | required | Returns tile data for a given index |
| `colorMode` | `number` | RGB | Forwarded to `HealpixCellsLayer` |
| `colorMap` | `Uint8Array` | — | 256×4 RGBA LUT for scalar modes |
| `rescaleMin` / `rescaleMax` | `number` | — | Scalar range → colorMap indices 0–255 |
| `filterMin` / `filterMax` | `number` | — | Discard cells outside range |
| `shaderModules` | `ShaderModule[]` | `[]` | Per-tile shader modules |
| `debugTiles` | `boolean` | `false` | Yellow border and `z-y-x` label on each loaded tile |
| `onStats` | `function` | — | Called after each update with `HealpixTileLayerStats` |

Other `TileLayer` props are forwarded (`maxCacheSize`, `refinementStrategy`, …).

### `refreshTileData(filter?)`

Re-invokes `getTileData` for tiles matching the predicate. With no predicate, all tiles are refreshed.

```typescript
// Refresh all tiles
layer.refreshTileData();

// Refresh only tiles at a specific partition cell
layer.refreshTileData(({ x }) => x === targetCell);
```

### `HealpixTileLayerStats`

```typescript
type HealpixTileLayerStats = {
  nside: number;
  nsideParent: number;
  tilesRendered: number;
  cellsRendered: number;
};
```

## Package structure

```
src/
  index.ts
  types.ts              — HealpixTileIndex, HealpixTileData
  layers/
    healpix-tile-layer.ts     — HealpixTileLayer
    healpix-tileset-2d.ts     — HealpixTileset2D (maps viewports to tile indices)
  lib/
    utils.ts            — getNsideForZoom, clampToAvailable, rowRangeFromOffsetPair
    sort-by-distance.ts — sortTileIndicesByViewportCenter
    tile-debug-layers.ts — createTileDebugLayers
```

## License

MIT
