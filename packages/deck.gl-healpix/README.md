![HEALPix Banner](https://raw.githubusercontent.com/developmentseed/deck.gl-healpix/main/docs/healpix-banner.png)

<p align='center'>
  <a href='https://github.com/developmentseed/healpix-ts'>HEALPix Typescript</a> | <a href='https://github.com/developmentseed/deck.gl-healpix'>HEALPix Deck.gl Layer</a> 
</p>

# deck.gl-healpix

A [deck.gl](https://deck.gl/) layer for rendering [HEALPix](https://healpix.sourceforge.io/) (Hierarchical Equal Area isoLatitude Pixelization) cells on a map.

It is suited for animating a large number of cells: per-cell values are uploaded once to the GPU and a configurable color pipeline (filter → rescale → color) runs every frame in the fragment shader. The pipeline is composed of luma.gl shader modules and exposes hook points so you can inject custom GLSL (band math, gamma rescale, classification, etc.) without forking the layer.

https://github.com/user-attachments/assets/4166d5d5-65e3-4309-a63a-0a2d0cdf275d

## Installation

```bash
npm install @developmentseed/deck.gl-healpix
```

Peer dependencies (`@deck.gl/core`, `@deck.gl/layers`) must be provided by the host application.

```bash
npm install @deck.gl/core @deck.gl/layers @luma.gl/core @luma.gl/engine
```

## Usage

### Single frame

Pass per-cell numeric `values` plus a `[rescaleMin, rescaleMax]` range. The layer normalizes each value and maps it through a 256-entry `colorMap` LUT on the GPU. If `colorMap` is omitted a linear black-to-white ramp is used.

```ts
import { HealpixCellsLayer } from '@developmentseed/deck.gl-healpix';

const cellIds = new Uint32Array([0, 1, 2, 3]);
const values = new Float32Array([0.1, 0.4, 0.7, 1.0]);

const layer = new HealpixCellsLayer({
  id: 'healpix',
  nside: 64,
  cellIds,
  values,
  rescaleMin: 0,
  rescaleMax: 1
});
```

`min` and `max` are still accepted as backwards-compatible aliases for `rescaleMin` / `rescaleMax`.

### Multi-frame animation

Provide a `frames` array whose entries override the root-level defaults. Advance `currentFrame` to switch between them — no GPU re-upload happens unless the underlying typed array changes.

```ts
import { HealpixCellsLayer } from '@developmentseed/deck.gl-healpix';

const cellIds = new Uint32Array([0, 1, 2, 3]);

const layer = new HealpixCellsLayer({
  id: 'healpix',
  nside: 64,
  cellIds,
  rescaleMin: 0,
  rescaleMax: 1,
  frames: [
    { values: new Float32Array([0.0, 0.25, 0.5, 0.75]) },
    { values: new Float32Array([1.0, 0.75, 0.5, 0.25]) }
  ],
  currentFrame: 0
});
```

Each frame may override any root-level field (`nside`, `scheme`, `cellIds`, `values`, `dimensions`, `colorMode`, `filterMin`, `filterMax`, `rescaleMin`, `rescaleMax`, `colorMap`, plus the legacy `min` / `max`). Fields omitted on a frame fall back to the root value. `shaderModules` is the only render-pipeline prop that is root-only.

### Filter and rescale

In scalar modes the layer runs a two-stage pipeline before the colorMap lookup:

- **Filter** — cells whose first value is outside `[filterMin, filterMax]` are discarded entirely (they do not contribute to picking either). Default: unbounded.
- **Rescale** — surviving values are linearly normalized through `[rescaleMin, rescaleMax]` and clamped to `[0, 1]` before the LUT lookup.

```ts
new HealpixCellsLayer({
  id: 'ndvi',
  nside,
  cellIds,
  values,
  filterMin: 0.2,    // hide bare soil / water
  rescaleMin: -0.1,
  rescaleMax: 0.8
});
```

### Direct RGB / RGBA values

Set `dimensions` to the number of source channels and pick a non-scalar `colorMode` to push color directly to the GPU, bypassing the colorMap. Values are interpreted as normalized channels (`0.0`–`1.0`) interleaved per cell.

```ts
import {
  HealpixCellsLayer,
  HEALPIX_COLOR_MODE_RGB
} from '@developmentseed/deck.gl-healpix';

new HealpixCellsLayer({
  id: 'healpix',
  nside: 64,
  cellIds: new Uint32Array([0, 1]),
  dimensions: 3,
  colorMode: HEALPIX_COLOR_MODE_RGB,
  // cell 0 → red, cell 1 → green
  values: new Float32Array([1, 0, 0, 0, 1, 0])
});
```

`dimensions` and `colorMode` are independent: `dimensions` controls how many source values are stored per cell (it can exceed `4`); `colorMode` controls how the selected `vec4` is interpreted for rendering.

### Custom colorMap

A `colorMap` is a `Uint8Array` of exactly **256 × 4 = 1024 bytes** in RGBA order. Index `0` maps to `rescaleMin`, index `255` to `rescaleMax`.

The `makeColorMap` helper builds one from a callback that is invoked 256 times with the normalized position `t = i / 255` and the raw byte index `i`. Return a hex string, a `[r, g, b]`/`[r, g, b, a]` tuple in `0`–`255`, or `{ normalized: true, rgba: [...] }` in `0`–`1`.

```ts
import { HealpixCellsLayer, makeColorMap } from '@developmentseed/deck.gl-healpix';

// Red → blue gradient
const colorMap = makeColorMap((t) => ({
  normalized: true,
  rgba: [1 - t, 0, t]
}));

// Three-stop hex ramp
const stepped = makeColorMap((_, i) =>
  i < 85 ? '#f00' : i < 170 ? '#0f0' : '#00f'
);

new HealpixCellsLayer({ /* ... */, colorMap });
```

You can also build the buffer yourself — the layer will accept any `Uint8Array` that is exactly `1024` bytes long.

## API

### `HealpixCellsLayer`

A `CompositeLayer` that renders HEALPix cells as filled polygons whose colors are computed on the GPU from per-cell float `values`.

| Prop            | Type                              | Default                         | Description                                                                                                  |
| --------------- | --------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `nside`         | `number`                          | —                               | HEALPix resolution parameter (power of 2). Required on the layer or on every frame.                          |
| `cellIds`       | `CellIdArray`                     | —                               | HEALPix cell indices to render. Required on the layer or on every frame.                                     |
| `scheme`        | `'nest' \| 'ring'`                | `'nest'`                        | Pixel numbering scheme.                                                                                      |
| `values`        | `ArrayLike<number>`               | —                               | Interleaved per-cell float values. Length = `cellIds.length × dimensions`. Required when `frames` is absent. |
| `dimensions`    | `number`                          | `1`                             | Source values stored per cell (any positive integer; values >`4` are packed across multiple texels).         |
| `colorMode`     | `HealpixColorMode`                | `HEALPIX_COLOR_MODE_SCALAR`     | How selected values are interpreted. See table below.                                                        |
| `filterMin`     | `number`                          | `-Infinity`                     | Inclusive lower bound. Cells with `valueAt(0) < filterMin` are discarded (scalar modes only).                |
| `filterMax`     | `number`                          | `Infinity`                      | Inclusive upper bound. Cells with `valueAt(0) > filterMax` are discarded (scalar modes only).                |
| `rescaleMin`    | `number`                          | `0`                             | Value mapped to colorMap index 0 (scalar modes only).                                                        |
| `rescaleMax`    | `number`                          | `1`                             | Value mapped to colorMap index 255 (scalar modes only).                                                      |
| `colorMap`      | `Uint8Array` (1024 B)             | black → white                   | 256-entry RGBA LUT used in scalar modes.                                                                     |
| `frames`        | `HealpixFrameObject[]`            | —                               | Optional animation frames; each may override any root field.                                                 |
| `currentFrame`  | `number`                          | `0`                             | Active index into `frames`. Clamped to `[0, frames.length - 1]`.                                             |
| `shaderModules` | `ShaderModule[]`                  | `[]`                            | Custom luma.gl shader modules appended after the built-in pipeline. Root-only (cannot be set per frame).     |

### `colorMode` modes

| Constant                          | Interpretation                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `HEALPIX_COLOR_MODE_SCALAR`       | `valueAt(0)` → filter → rescale → colorMap LUT → RGBA. Alpha = `1`.                           |
| `HEALPIX_COLOR_MODE_SCALAR_ALPHA` | `valueAt(0)` → filter → rescale → colorMap LUT, then multiplied by `valueAt(1)` as alpha.     |
| `HEALPIX_COLOR_MODE_RGB`          | Direct `vec4(valueAt(0), valueAt(1), valueAt(2), 1)`. Filter / rescale / colorMap ignored.    |
| `HEALPIX_COLOR_MODE_RGBA`         | Direct `vec4(valueAt(0..3))`. Filter / rescale / colorMap ignored.                            |

`values` is always an interleaved flat array: cell `i` occupies indices `i * dimensions` through `i * dimensions + dimensions - 1`.

`dimensions` controls texture packing only — it is decoupled from `colorMode`. You can store ten bands per cell (`dimensions: 10`) and still pick which channels the renderer consumes via a custom `HEALPIX_SELECT_VALUES` injection (see below).

### Custom shader modules

The primitive layer registers two custom fragment-shader hooks (deck.gl-style `inout` signatures):

- `fs:HEALPIX_SELECT_VALUES(inout vec4 selectedValues, FragmentGeometry geometry)` — runs after the default selection (`channels 0..3`), before filter/rescale. Use it to compute derived values (NDVI, classification, etc.). Calling `discard;` here drops the cell entirely (including from picking).
- `fs:HEALPIX_RESCALE_VALUES(inout vec4 selectedValues, FragmentGeometry geometry)` — runs after the built-in rescale, before the colorMap lookup. Use it to apply gamma, sigmoid, or any final scalar transform.

> **Important — write to `selectedValues`.** GLSL `inout` is copy-in / copy-out. The hook body receives a local copy of the global as `selectedValues`; on return, that local is written back over the global. Writing directly to `healpixSelectedValues` from inside a hook body is silently overwritten by the unchanged parameter on function return.

Inside the hooks the values module exposes (in addition to the `selectedValues` parameter):

```glsl
int   healpixCell;            // current cell index
int   healpixDimensions;      // source channel count
int   healpixColorMode;       // active HEALPIX_COLOR_MODE_*
float healpixValueAt(int channel); // any channel in [0, healpixDimensions)
```

Pass custom modules via the root-level `shaderModules` prop:

```ts
import {
  HealpixCellsLayer,
  HEALPIX_COLOR_MODE_SCALAR
} from '@developmentseed/deck.gl-healpix';

const ndviSelector = {
  name: 'ndviSelector',
  inject: {
    'fs:HEALPIX_SELECT_VALUES': `\
float nir = healpixValueAt(7);
float red = healpixValueAt(3);
float ndvi = (nir - red) / max(nir + red, 1e-6);
selectedValues = vec4(ndvi, 0.0, 0.0, 0.0);
`
  }
};

const gammaRescale = {
  name: 'gammaRescale',
  inject: {
    'fs:HEALPIX_RESCALE_VALUES': `\
selectedValues.x = pow(clamp(selectedValues.x, 0.0, 1.0), 0.5);
`
  }
};

new HealpixCellsLayer({
  id: 'ndvi',
  nside,
  cellIds,
  values,                // 10 bands per cell
  dimensions: 10,
  colorMode: HEALPIX_COLOR_MODE_SCALAR,
  rescaleMin: -1,
  rescaleMax: 1,
  colorMap,
  shaderModules: [ndviSelector, gammaRescale]
});
```

The fragment pipeline is:

```
healpixValues  → default select (channels 0..3)
               → fs:HEALPIX_SELECT_VALUES   (user, optional)
               → healpixFilter              (scalar modes)
               → healpixRescale             (scalar modes)
               → fs:HEALPIX_RESCALE_VALUES  (user, optional)
               → healpixColor               (colorMap or direct RGB/RGBA)
               → fragColor
```

### `HealpixFrameObject`

Every field is optional and falls back to the matching root-level prop. `values` is the only field that must be set somewhere (root or frame). `shaderModules` is root-only.

```ts
type HealpixFrameObject = {
  nside?: number;
  scheme?: 'nest' | 'ring';
  cellIds?: CellIdArray;
  values?: ArrayLike<number>;
  dimensions?: number;
  colorMode?: HealpixColorMode;
  filterMin?: number;
  filterMax?: number;
  rescaleMin?: number;
  rescaleMax?: number;
  colorMap?: Uint8Array;
};
```

### `makeColorMap(getColor)`

Build a 256-entry RGBA colorMap (1024 bytes) from a callback.

```ts
import { makeColorMap } from '@developmentseed/deck.gl-healpix';

const viridisLike = makeColorMap((t) => ({
  normalized: true,
  rgba: [t * t, Math.sqrt(t), 1 - t]
}));
```

The callback receives `(t: number, index: number)` where `t = index / 255` in `[0, 1]`. Return one of:

- a CSS hex string — `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`
- a 3- or 4-tuple of bytes in `0`–`255` (alpha defaults to `255`)
- `{ normalized: true, rgba: [r, g, b] | [r, g, b, a] }` with channels in `0`–`1`

Values outside their valid range are clamped.

### Types and constants

```ts
import {
  HEALPIX_COLOR_MODE_SCALAR,
  HEALPIX_COLOR_MODE_SCALAR_ALPHA,
  HEALPIX_COLOR_MODE_RGB,
  HEALPIX_COLOR_MODE_RGBA
} from '@developmentseed/deck.gl-healpix';

import type {
  HealpixCellsLayerProps,
  HealpixFrameObject,
  HealpixScheme,
  HealpixColorMode,
  CellIdArray,
  ColorMapCallbackValue
} from '@developmentseed/deck.gl-healpix';
```

- **`HealpixScheme`** — `'nest' | 'ring'`
- **`CellIdArray`** — `Int32Array | Uint32Array | Float32Array | Float64Array`
- **`HealpixColorMode`** — Union of the four `HEALPIX_COLOR_MODE_*` integer constants.
- **`HealpixCellsLayerProps`** — Full prop type for the layer.
- **`HealpixFrameObject`** — One animation frame; see above.
- **`ColorMapCallbackValue`** — Return type accepted by the `makeColorMap` callback.

## Development

The published library lives in `packages/@developmentseed/deck.gl-healpix`. The repo is an npm-workspaces + [Lerna](https://lerna.js.org/) monorepo. Shared TypeScript, Rollup, and tooling are at the root; run commands from the repo root.

## License

MIT — see [LICENSE](LICENSE).
