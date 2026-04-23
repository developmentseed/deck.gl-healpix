# Merge `feature/gpu-corners` into `main` — Design Spec

**Date:** 2026-04-23
**Branch target:** `feature/gpu-corners`
**Merge source:** `main`

## Goal

Produce a single monorepo branch that combines:

1. **Monorepo structure** from `main` (`packages/deck.gl-healpix/`)
2. **GPU cell decoding / corner computation** from `feature/gpu-corners` (`HealpixCellsPrimitiveLayer` + GLSL shaders)
3. **GPU color computation** from `main` (`HealpixColorExtension` — values texture + colormap LUT)

The old CPU geometry pipeline (`computeGeometry`, `tile-grid.worker`) and the old color-frames API (`HealpixColorFramesExtension`, `colorFrames: Uint8Array[]`) are removed entirely.

## Architecture

```
HealpixCellsLayer (CompositeLayer)
 Props : nside, cellIds, scheme,
         values, min, max, dimensions,
         colorMap, frames, currentFrame
 State : cellIdLo, cellIdHi,
         valuesTexture, colorMapTexture,
         prevResolved
 renderLayers()
  └─ HealpixCellsPrimitiveLayer
      instanced attrs : cellIdLo, cellIdHi, healpixCellIndex
      extensions      : [HealpixColorExtension]
      props           : valuesTexture, colorMapTexture,
                        uMin, uMax, uDimensions, uValuesWidth
```

`healpixCellIndex` is a generated `Float32Array([0, 1, …, N-1])` supplied as an instanced attribute by `HealpixCellsLayer`. It lets `HealpixColorExtension`'s shader injection look up the per-cell values texel without relying on `gl_InstanceID`.

## Key design decisions

### `healpixCellIndex` stepMode change

`HealpixColorExtension.initializeState` currently registers `healpixCellIndex` with `stepMode: 'vertex'`. In the GPU instanced model all 4 vertices of one instance (cell) must share the same index, so the step mode changes to `'instance'`.

### CPU geometry removed

`HealpixCellsPrimitiveLayer` renders cells entirely in the vertex shader (fp64 corner computation via `fxyCorner`). `computeGeometry`, `tile-grid.worker`, and their tests are deleted.

### Old color API removed

`HealpixColorFramesExtension` and `color-frame.ts` are deleted. The only public color API is main's (`values`, `colorMap`, `min`, `max`, `dimensions`, `frames`, `currentFrame`).

## File changes

### Bring from `feature/gpu-corners` → `packages/deck.gl-healpix/`

| Source path (feature branch) | Destination |
|------------------------------|-------------|
| `src/shaders/` (entire dir)  | `packages/deck.gl-healpix/src/shaders/` |
| `src/layers/healpix-cells-primitive-layer.ts` | `packages/deck.gl-healpix/src/layers/` |
| `src/utils/split-cell-ids.ts` | `packages/deck.gl-healpix/src/utils/` |
| `src/utils/split-cell-ids.test.ts` | `packages/deck.gl-healpix/src/utils/` |
| `test/gpu/` (entire dir) | `test/gpu/` |

### Modify (main base)

| File | Change |
|------|--------|
| `packages/.../src/layers/healpix-cells-layer.ts` | Full rewrite: GPU primitive + GPU color (see Section 3) |
| `packages/.../src/extensions/healpix-color-extension.ts` | `stepMode: 'vertex'` → `'instance'` |
| `packages/.../src/index.ts` | Add `splitCellIds` export; remove dead exports |

### Conflict resolution during `git merge main`

| File | Resolution |
|------|-----------|
| `package.json` | Take main's |
| `src/index.ts` → `packages/.../src/index.ts` | Take main's path/content; add `splitCellIds` export |
| `src/layers/healpix-cells-layer.ts` | Discard both sides; write combined version |
| `src/utils/color-frame.ts` (delete/modify conflict) | Accept deletion — superseded by `color-map.ts` |
| `eslint.config.mjs` | Take main's |
| `tsconfig.json` / `tsconfig.jest.json` | Take main's |
| `rollup.config.mjs` | Take main's |

### Delete

| Path | Reason |
|------|--------|
| `src/extensions/healpix-color-frames-extension.ts` | Old color API (feature branch) |
| `src/extensions/healpix-color-frames-shader-module.ts` | Old color API (feature branch) |
| `packages/.../src/geometry/compute-geometry.ts` | CPU geometry replaced by GPU |
| `packages/.../src/geometry/compute-geometry.test.ts` | CPU geometry replaced by GPU |
| `packages/.../src/geometry/types.ts` | CPU geometry replaced by GPU |
| `packages/.../src/workers/tile-grid.worker.ts` | CPU geometry worker no longer needed |
| `packages/.../src/workers/tile-grid.worker.test.ts` | CPU geometry worker no longer needed |
| `src/utils/color-frame.ts` | Old color API superseded by `color-map.ts` |
| `src/utils/color-frame.test.ts` | Old color API superseded by `color-map.ts` |

## `HealpixCellsLayer` rewrite detail

### State shape

```ts
type HealpixCellsLayerState = {
  cellIdLo: Uint32Array;
  cellIdHi: Uint32Array;
  cellIndex: Float32Array;          // [0, 1, …, N-1] for HealpixColorExtension
  valuesTexture: Texture | null;
  colorMapTexture: Texture | null;
  prevResolved: ResolvedFrame | null;
};
```

### `updateState` logic

- `cellIds` changed → re-run `splitCellIds`, rebuild `cellIndex` (`Float32Array.from({length:N}, (_,i)=>i)`) — both stored in state, not regenerated per-render
- `frames`/`values`/`colorMap`/`min`/`max`/`dimensions` changed → re-resolve frame via `resolveFrame`, rebuild textures via `packValuesData` / `makeColorMap`

### `renderLayers()`

```ts
new HealpixCellsPrimitiveLayer(
  this.getSubLayerProps({
    id: 'cells',
    nside, scheme,
    instanceCount: count,
    data: {
      length: count,
      attributes: {
        cellIdLo:         { value: cellIdLo,   size: 1 },
        cellIdHi:         { value: cellIdHi,   size: 1 },
        healpixCellIndex: { value: cellIndex,  size: 1 }  // from state, built in updateState
      }
    },
    valuesTexture, colorMapTexture,
    uMin, uMax, uDimensions, uValuesWidth,
    extensions: [HEALPIX_COLOR_EXTENSION]
  })
)
```

## Verification

1. `npm run build` succeeds in the monorepo root
2. `npm test` passes (unit tests for `splitCellIds`, `color-map`, `resolve-frame`, `values-texture`, `array-buffer`, `hash`)
3. GPU readback harness (`test/gpu/`) renders correct cell positions at nside=1,2,4 for both NEST and RING schemes
4. Color mapping via `values`/`colorMap`/`min`/`max` renders correct gradients
5. `frames`/`currentFrame` animation works
6. No TypeScript errors (`tsc --noEmit`)
