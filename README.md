# healpix-layers-deck.gl

A [deck.gl](https://deck.gl/) layer for rendering [HEALPix](https://healpix.jpl.nasa.gov/) (Hierarchical Equal Area isoLatitude Pixelization) cells on a map.

## Installation

```bash
npm install healpix-layers-deck.gl
```

Peer dependencies (`@deck.gl/core`, `@deck.gl/layers`) must be provided by the host application.

## Usage

```ts
import { HealpixCellsLayer } from 'healpix-layers-deck.gl';

const layer = new HealpixCellsLayer({
  id: 'healpix',
  nside: 64,
  cellIds: new Int32Array([0, 1, 2, 3]),
  scheme: 'nest',
  getFillColor: new Float32Array([
    1, 0, 0, 1,   // cell 0 — red
    0, 1, 0, 1,   // cell 1 — green
    0, 0, 1, 1,   // cell 2 — blue
    1, 1, 0, 1,   // cell 3 — yellow
  ]),
});
```

## API

### `HealpixCellsLayer`

A `CompositeLayer` that renders HEALPix cells as filled polygons.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `nside` | `number` | `0` | HEALPix resolution parameter (must be a power of 2). |
| `cellIds` | `Int32Array` | `Int32Array(0)` | HEALPix cell indices to render. |
| `scheme` | `'nest' \| 'ring'` | `'nest'` | Pixel numbering scheme. |
| `getFillColor` | `Float32Array` | `Float32Array(0)` | Per-cell RGBA colors normalised to 0–1. Length must equal `cellIds.length * 4`. |

All standard deck.gl `CompositeLayer` props (e.g. `visible`, `opacity`, `pickable`) are also accepted.

### Types

```ts
import type { HealpixCellsLayerProps, HealpixScheme } from 'healpix-layers-deck.gl';
```

- **`HealpixScheme`** — `'nest' | 'ring'`
- **`HealpixCellsLayerProps`** — Full prop type for the layer.

## Development

```bash
npm install
npm run build         # one-shot build (CJS + ESM + types)
npm run build:watch   # watch mode
npm run lint          # ESLint
npm test              # Jest
```

## License

MIT — see [LICENSE](LICENSE).
