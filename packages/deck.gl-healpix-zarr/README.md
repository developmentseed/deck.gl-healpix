# @developmentseed/deck.gl-healpix-zarr

A deck.gl layer for rendering HEALPix data from a [HEALPix Pyramid Zarr](../../docs/specs/healpix-pyramid-zarr.md) store (Zarr v3).

`HealpixZarrTileLayer` streams sparse HEALPix cells from a conformant store, picks an nside for the current zoom, and renders them with `HealpixCellsLayer`.

**Store format:** see [docs/specs/healpix-pyramid-zarr.md](../../docs/specs/healpix-pyramid-zarr.md) for layout, attributes, arrays, and conformance rules.

**Layer behavior:**

- Root `parent_levels` is read from the store and passed to `HealpixTileset2D`.
- Tile index `{ x, y, z }`: `x` = parent cell at `nside_parent` (NESTED); `y` = `log2(nside_parent)`; `z` = `log2(nside)` for the data level opened as `nside_<N>/`. Tile ids are `z-y-x`.
- Selected `bands` are loaded from `bands/<name>` and interleaved per pixel as `[b0_p0, b1_p0, …, b0_p1, …]` in prop order.

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
  zoomOffset: 5,
  colorMode: HEALPIX_COLOR_MODE_RGB,
  onMetadata: (meta: ZarrPyramidMetadata) => {
    console.log(meta.bands, meta.nsides);
  },
});
```

### Props

| prop | type | default | description |
|------|------|---------|-------------|
| `url` | `string` | `''` | URL of a store conforming to the [data spec](../../docs/specs/healpix-pyramid-zarr.md) |
| `bands` | `string[] \| null` | `null` | Bands to load; `null` loads nothing. Order sets interleaved value columns. |
| `zoomOffset` | `number` | (TileLayer) | `nside = 2^round(zoom + zoomOffset)` |
| `colorMode` | `number` | RGB | Forwarded to `HealpixCellsLayer` |
| `colorMap` | `Uint8Array` | — | 256×4 RGBA LUT for scalar modes |
| `rescaleMin` / `rescaleMax` | `number` | — | Scalar range → colorMap indices 0 and 255 |
| `filterMin` / `filterMax` | `number` | — | Discard cells outside range |
| `shaderModules` | `ShaderModule[]` | `[]` | Per-tile shader modules |
| `onMetadata` | `function` | — | `(meta: ZarrPyramidMetadata, root) => void` when root metadata loads |
| `onStats` | `function` | — | Tile/cell render counts after each update |
| `debugTiles` | `boolean` | `false` | Yellow border and `z-y-x` tile id label on each loaded tile |

`onMetadata` receives `ZarrPyramidMetadata` (`bands`, `nsides`, `baseNside`, `minNside`, `parentLevels`) derived from root attributes in the spec.

Other `TileLayer` props are forwarded (`maxCacheSize`, `refinementStrategy`, …).

## License

MIT
