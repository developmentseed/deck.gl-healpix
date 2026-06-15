# @developmentseed/deck.gl-healpix-zarr

A deck.gl layer for rendering HEALPix data from a [HEALPix Pyramid Zarr](../../docs/specs/healpix-pyramid-zarr.md) store (Zarr v3).

`HealpixZarrTileLayer` extends [`HealpixTileLayer`](../deck.gl-healpix-tile) from `@developmentseed/deck.gl-healpix-tile`, adding Zarr-specific data loading. It reads pyramid metadata on mount, selects an nside for the current zoom level, and renders tiles with `HealpixCellsLayer`.

**Store format:** see [docs/specs/healpix-pyramid-zarr.md](../../docs/specs/healpix-pyramid-zarr.md) for layout, attributes, arrays, and conformance rules.

**Tile index convention:** `{ x, y, z }` where `x` = parent cell at `nside_partition` (NESTED), `y` = `log2(nside_partition)`, `z` = `log2(nside)` for the data level. Selected `bands` are loaded from `bands/<name>` and interleaved per pixel as `[b0_p0, b1_p0, …, b0_p1, …]` in prop order. Tile ids are `z-y-x`.

## Installation

```bash
npm install @developmentseed/deck.gl-healpix-zarr
```

Peer dependencies: `@deck.gl/core`, `@deck.gl/geo-layers`, `@deck.gl/layers`, `@luma.gl/core`, `@luma.gl/engine`.

## Usage

```typescript
import {
  HealpixZarrTileLayer,
  type ZarrPyramidMetadata,
} from '@developmentseed/deck.gl-healpix-zarr';
import { HEALPIX_COLOR_MODE_RGB } from '@developmentseed/deck.gl-healpix';

const layer = new HealpixZarrTileLayer({
  url: 'https://example.com/sentinel2-pyramid.zarr',
  bands: ['b04', 'b03', 'b02'],
  colorMode: HEALPIX_COLOR_MODE_RGB,
  onMetadata: (meta: ZarrPyramidMetadata) => {
    console.log(meta.bands, meta.nsides);
  },
});
```

### Zarr-specific props

| prop | type | default | description |
|------|------|---------|-------------|
| `url` | `string` | `''` | URL of a store conforming to the [data spec](../../docs/specs/healpix-pyramid-zarr.md) |
| `bands` | `string[] \| null` | `null` | Bands to load; `null` loads nothing. Order sets interleaved value columns. |
| `onMetadata` | `function` | — | `(meta: ZarrPyramidMetadata, root) => void` called when root metadata loads (and again if `url` changes) |

`ZarrPyramidMetadata` provides `bands`, `nsides`, `baseNside`, `minNside`, and `parentLevels` derived from root Zarr attributes.

### Inherited props

All visual and tile-control props come from `HealpixTileLayer` — see [@developmentseed/deck.gl-healpix-tile](../deck.gl-healpix-tile):

| prop | type | default | description |
|------|------|---------|-------------|
| `zoomOffset` | `number` | (TileLayer) | Shifts the zoom-to-nside mapping. **Advanced:** rarely needs adjustment; changing the default loads significantly more data. |
| `colorMode` | `number` | RGB | Forwarded to `HealpixCellsLayer` |
| `colorMap` | `Uint8Array` | — | 256×4 RGBA LUT for scalar modes |
| `rescaleMin` / `rescaleMax` | `number` | — | Scalar range → colorMap indices 0–255 |
| `filterMin` / `filterMax` | `number` | — | Discard cells outside range |
| `shaderModules` | `ShaderModule[]` | `[]` | Per-tile shader modules |
| `debugTiles` | `boolean` | `false` | Yellow border and `z-y-x` tile id label on each loaded tile |
| `onStats` | `function` | — | Tile/cell render counts after each update |

Other `TileLayer` props are forwarded (`maxCacheSize`, `refinementStrategy`, …).

## License

MIT
