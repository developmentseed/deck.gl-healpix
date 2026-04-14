![HEALPix Banner](./docs/healpix-banner.png)

<p align='center'>
  <a href='https://github.com/developmentseed/healpix-ts'>HEALPix Typescript</a> | <a href='https://github.com/developmentseed/healpix-layers-deck.gl'>HEALPix Deck.gl Layer</a> 
</p>


# HEALPix Deck.gl Layer

A [deck.gl](https://deck.gl/) layer for rendering [HEALPix](https://healpix.sourceforge.io/) (Hierarchical Equal Area isoLatitude Pixelization) cells on a map.  
It is especially suited for animating a large number of cells.

![HEALPix Deck.gl Layer](./docs/earth-anim.mp4)

## Installation

```bash
npm install healpix-layers-deck.gl
```

Peer dependencies (`@deck.gl/core`, `@deck.gl/layers`) must be provided by the host application.

```bash
npm install @deck.gl/core @deck.gl/layers
```

## Usage

```ts
import { HealpixCellsLayer, makeColorFrameFromValues } from 'healpix-layers-deck.gl';

const cellIds = new Int32Array([0, 1, 2, 3]);

const frame0 = makeColorFrameFromValues(cellIds, (value) =>{
  return ['#f00', '#0f0', '#00f', '#ff0'][value];
});

const frame1 = makeColorFrameFromValues(cellIds, (value) =>{
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

A `CompositeLayer` that renders HEALPix cells as filled polygons.

| Prop           | Type               | Default         | Description                                                                                   |
| -------------- | ------------------ | --------------- | --------------------------------------------------------------------------------------------- |
| `nside`        | `number`           | `0`             | HEALPix resolution parameter (must be a power of 2).                                          |
| `cellIds`      | `Int32Array`       | `Int32Array(0)` | HEALPix cell indices to render.                                                               |
| `scheme`       | `'nest' \| 'ring'` | `'nest'`        | Pixel numbering scheme.                                                                       |
| `colorFrames`  | `Uint8Array[]`     | `[]`            | Color animation frames. Each frame must be `cellIds.length * 4` in RGBA byte order (`0-255`). |
| `currentFrame` | `number`           | `0`             | Frame index to render. Values are clamped into valid range.                                   |

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
