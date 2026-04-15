![HEALPix Banner](./docs/healpix-banner.png)

<p align='center'>
  <a href='https://github.com/developmentseed/healpix-ts'>HEALPix Typescript</a> | <a href='https://github.com/developmentseed/healpix-layers-deck.gl'>HEALPix Deck.gl Layer</a> 
</p>


# HEALPix Deck.gl Layer

A [deck.gl](https://deck.gl/) layer for rendering [HEALPix](https://healpix.sourceforge.io/) (Hierarchical Equal Area isoLatitude Pixelization) cells on a map.  
It is especially suited for animating a large number of cells.

Cell corner positions are computed entirely on the GPU in the vertex shader using fp64 emulation, so cells render in the same frame their data arrives — no workers, no async pipeline, no triangulation overhead.

https://github.com/user-attachments/assets/4166d5d5-65e3-4309-a63a-0a2d0cdf275d

## Installation

```bash
npm install healpix-layers-deck.gl
```

Peer dependencies must be provided by the host application:

```bash
npm install @deck.gl/core @luma.gl/engine
```

## Usage

```ts
import { HealpixCellsLayer, makeColorFrameFromValues } from 'healpix-layers-deck.gl';

const cellIds = new Uint32Array([0, 1, 2, 3]);

const frame0 = makeColorFrameFromValues(cellIds, (value) => {
  return ['#f00', '#0f0', '#00f', '#ff0'][value];
});

const frame1 = makeColorFrameFromValues(cellIds, (value) => {
  return ['#fff', '#888', '#444', '#000'][value];
});

const layer = new HealpixCellsLayer({
  id: 'healpix',
  nside: 64,
  cellIds,
  scheme: 'nest',
  colorFrames: [frame0, frame1],
  currentFrame: 0
});
```

## API

### `HealpixCellsLayer`

A `CompositeLayer` that renders HEALPix cells as instanced quads with GPU-computed corners.

| Prop           | Type               | Default            | Description                                                                                   |
| -------------- | ------------------ | ------------------ | --------------------------------------------------------------------------------------------- |
| `nside`        | `number`           | `0`                | HEALPix resolution parameter (must be a power of 2, up to 262144).                            |
| `cellIds`      | `CellIdArray`      | `Uint32Array(0)`   | HEALPix cell indices to render. Use `Float64Array` for nside > 8192 (cell IDs exceed 2^32).   |
| `scheme`       | `'nest' \| 'ring'` | `'nest'`           | Pixel numbering scheme.                                                                       |
| `colorFrames`  | `Uint8Array[]`     | `[]`               | Color animation frames. Each frame must be `cellIds.length * 4` in RGBA byte order (`0-255`). |
| `currentFrame` | `number`           | `0`                | Frame index to render. Values are clamped into valid range.                                   |

### Types

```ts
import type {
  HealpixCellsLayerProps,
  HealpixScheme,
  CellIdArray
} from 'healpix-layers-deck.gl';
```

- **`CellIdArray`** — `Int32Array | Uint32Array | Float64Array | Float32Array`
- **`HealpixScheme`** — `'nest' | 'ring'`
- **`HealpixCellsLayerProps`** — Full prop type for the layer.

### `makeColorFrameFromValues`

```ts
import { makeColorFrameFromValues } from 'healpix-layers-deck.gl';

const frame = makeColorFrameFromValues(values, (value, index) => {
  // Return a color as:
  //   - hex string: '#f00', '#ff0000', '#ff0000ff'
  //   - byte tuple: [255, 0, 0] or [255, 0, 0, 128]
  //   - normalized: { normalized: true, rgba: [1, 0, 0] }
  return '#f00';
});
```

## How it works

1. `cellIds` are split into `(lo, hi)` uint32 pairs on the main thread (synchronous, O(n)).
2. The pairs are uploaded to the GPU as instanced attributes.
3. A custom vertex shader decodes NEST pixel coordinates (or converts RING → NEST first), computes face coordinates `(t, u)` in fp64, applies corner offsets, and projects to Mercator via deck.gl's projection pipeline.
4. Colors are sampled from a 2D-array texture indexed by `gl_InstanceID` and the current frame.

No workers, no earcut triangulation, no async round-trips.

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
