# GPU Corners + Main Monorepo Merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `main` into `feature/gpu-corners` to produce a single branch with a Lerna monorepo structure, GPU cell-corner decoding (`HealpixCellsPrimitiveLayer` + fp64 GLSL shaders), and GPU color computation (`HealpixColorExtension` — values texture + colormap LUT), removing all CPU geometry and the old color-frames API.

**Architecture:** `HealpixCellsLayer` (CompositeLayer) → `HealpixCellsPrimitiveLayer` (GPU-instanced, 4 verts/cell, fp64 lon/lat in vertex shader) + `HealpixColorExtension` (RGBA32F values texture sampled by `healpixCellIndex` instanced attribute → 256-entry LUT → fragment color). No workers, no CPU geometry.

**Tech Stack:** TypeScript 5, deck.gl 9.x, luma.gl, GLSL ES 3.0, Rollup, Jest 30, Lerna 8 monorepo.

---

## File Map

| Path | Action | Role |
|------|--------|------|
| `packages/deck.gl-healpix/src/layers/healpix-cells-layer.ts` | Rewrite | CompositeLayer: resolves frames, splits cell IDs, uploads textures, renders GPU primitive |
| `packages/deck.gl-healpix/src/layers/healpix-cells-primitive-layer.ts` | Add (from feature) | GPU-instanced layer: 4 verts/cell, corner math in vertex shader |
| `packages/deck.gl-healpix/src/shaders/` | Add (from feature) | fp64, int64, HEALPix decompose, corner math, vertex/fragment shader entry points |
| `packages/deck.gl-healpix/src/utils/split-cell-ids.ts` | Add (from feature) | Splits 64-bit cell IDs into lo/hi u32 pair for GPU |
| `packages/deck.gl-healpix/src/utils/split-cell-ids.test.ts` | Add (from feature) | Unit tests for splitCellIds |
| `packages/deck.gl-healpix/src/extensions/healpix-color-extension.ts` | Modify | Change `healpixCellIndex` stepMode from `'vertex'` → `'instance'` |
| `packages/deck.gl-healpix/src/index.ts` | Modify | Remove worker/config/geometry exports; add `splitCellIds` |
| `packages/deck.gl-healpix/package.json` | Modify | Remove `./worker` export and `healpix-ts` dependency |
| `packages/deck.gl-healpix/src/types/layer-props.ts` | Modify | Remove `VERTS_PER_CELL` export (CPU geometry artifact) |
| `packages/deck.gl-healpix/src/geometry/` | Delete | CPU geometry replaced by GPU vertex shader |
| `packages/deck.gl-healpix/src/workers/` | Delete | CPU geometry worker no longer needed |
| `packages/deck.gl-healpix/src/config.ts` | Delete | Worker configuration, no longer needed |
| `packages/deck.gl-healpix/src/__mocks__/worker-code.ts` | Delete | Jest mock for worker, no longer needed |
| `src/extensions/healpix-color-frames-extension.ts` | Delete | Old color API (feature branch) |
| `src/extensions/healpix-color-frames-shader-module.ts` | Delete | Old color API (feature branch) |

---

## Task 1: Run the merge

**Files:** none modified yet — this establishes the conflict list.

- [ ] **Step 1: Checkout the feature branch**

```bash
git checkout feature/gpu-corners
```

Expected: `Switched to branch 'feature/gpu-corners'`

- [ ] **Step 2: Start the merge**

```bash
git merge main --no-commit --no-ff
```

Expected output contains lines like:
```
CONFLICT (modify/delete): src/utils/color-frame.ts deleted in main and modified in HEAD.
CONFLICT (content): packages/deck.gl-healpix/src/layers/healpix-cells-layer.ts
Auto-merging package.json
CONFLICT (content): package.json
Auto-merging eslint.config.mjs
CONFLICT (content): eslint.config.mjs
...
Automatic merge failed; fix conflicts then commit.
```

- [ ] **Step 3: List all conflicts**

```bash
git diff --name-only --diff-filter=U
```

Take note of every file listed. Tasks 2–4 resolve them all.

---

## Task 2: Resolve config-file conflicts — take main's version

Main's config files are correct for the monorepo. For each file below, discard the feature-branch version.

**Files:** `package.json`, `eslint.config.mjs`, `tsconfig.json`, `tsconfig.jest.json`, `rollup.config.mjs`, `README.md`

- [ ] **Step 1: Accept main's version for all config files**

```bash
git checkout --theirs package.json eslint.config.mjs rollup.config.mjs README.md
```

For tsconfig files (may or may not conflict — run only for files that appear in `git diff --name-only --diff-filter=U`):

```bash
git checkout --theirs tsconfig.json tsconfig.jest.json 2>/dev/null || true
```

- [ ] **Step 2: Stage the resolved files**

```bash
git add package.json eslint.config.mjs rollup.config.mjs README.md tsconfig.json tsconfig.jest.json 2>/dev/null || true
```

- [ ] **Step 3: Verify no remaining conflict markers**

```bash
grep -rn "<<<<<<" package.json eslint.config.mjs rollup.config.mjs README.md 2>/dev/null | head
```

Expected: no output.

---

## Task 3: Resolve delete/modify conflict — `src/utils/color-frame.ts`

Main deleted (renamed) this file; the feature branch modified it. Accept the deletion.

**Files:** `src/utils/color-frame.ts`, `src/utils/color-frame.test.ts`

- [ ] **Step 1: Accept main's deletion for color-frame**

```bash
git rm src/utils/color-frame.ts src/utils/color-frame.test.ts 2>/dev/null || true
```

If `color-frame.test.ts` also appears as a conflict, remove it the same way. If either path was already removed by git, the `|| true` skips the error.

- [ ] **Step 2: Verify they are gone**

```bash
ls src/utils/color-frame*.ts 2>/dev/null && echo "STILL EXISTS — remove manually" || echo "OK: deleted"
```

Expected: `OK: deleted`

---

## Task 4: Resolve `healpix-cells-layer.ts` conflict — accept theirs, then rewrite

The conflict lands at `packages/deck.gl-healpix/src/layers/healpix-cells-layer.ts`. Accept main's version to clear the conflict marker — we rewrite the file completely in Task 10.

**Files:** `packages/deck.gl-healpix/src/layers/healpix-cells-layer.ts`

- [ ] **Step 1: Accept main's version to clear the conflict**

```bash
git checkout --theirs packages/deck.gl-healpix/src/layers/healpix-cells-layer.ts
git add packages/deck.gl-healpix/src/layers/healpix-cells-layer.ts
```

- [ ] **Step 2: Resolve any remaining conflicts**

```bash
git diff --name-only --diff-filter=U
```

If any files still listed, accept main's version:

```bash
git diff --name-only --diff-filter=U | xargs -I{} git checkout --theirs {}
git diff --name-only --diff-filter=U | xargs git add
```

- [ ] **Step 3: Complete the merge commit**

```bash
git commit -m "Merge main into feature/gpu-corners (monorepo + GPU color)"
```

Expected: merge commit created on `feature/gpu-corners`.

---

## Task 5: Move shader files into the monorepo package

After the merge, GPU shaders still live at `src/shaders/` (root-level, feature-branch paths). Move them to `packages/deck.gl-healpix/src/shaders/`.

**Files:** `src/shaders/` → `packages/deck.gl-healpix/src/shaders/`

- [ ] **Step 1: Move the shaders directory**

```bash
git mv src/shaders packages/deck.gl-healpix/src/shaders
```

- [ ] **Step 2: Verify contents at new path**

```bash
ls packages/deck.gl-healpix/src/shaders/
```

Expected:
```
__tests__/  fp64.glsl.ts  healpix-cells-shader-module.ts
healpix-cells.fs.glsl.ts  healpix-cells.vs.glsl.ts
healpix-corners.glsl.ts  healpix-decompose.glsl.ts
index.ts  int64.glsl.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Move GPU shaders into monorepo package"
```

---

## Task 6: Move `HealpixCellsPrimitiveLayer` into the monorepo package

**Files:** `src/layers/healpix-cells-primitive-layer.ts` → `packages/deck.gl-healpix/src/layers/`

- [ ] **Step 1: Move the file**

```bash
git mv src/layers/healpix-cells-primitive-layer.ts packages/deck.gl-healpix/src/layers/healpix-cells-primitive-layer.ts
```

- [ ] **Step 2: Verify the move**

```bash
ls packages/deck.gl-healpix/src/layers/
```

Expected: `healpix-cells-layer.ts  healpix-cells-primitive-layer.ts`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Move HealpixCellsPrimitiveLayer into monorepo package"
```

---

## Task 7: Move `split-cell-ids` utilities into the monorepo package

**Files:** `src/utils/split-cell-ids.ts`, `src/utils/split-cell-ids.test.ts`

- [ ] **Step 1: Move files**

```bash
git mv src/utils/split-cell-ids.ts packages/deck.gl-healpix/src/utils/split-cell-ids.ts
git mv src/utils/split-cell-ids.test.ts packages/deck.gl-healpix/src/utils/split-cell-ids.test.ts
```

- [ ] **Step 2: Verify**

```bash
ls packages/deck.gl-healpix/src/utils/split-cell-ids*
```

Expected: both files listed under `packages/`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Move split-cell-ids into monorepo package"
```

---

## Task 8: Delete dead files — CPU geometry, worker, old extensions, config

**Files:** see list below.

- [ ] **Step 1: Delete CPU geometry**

```bash
git rm packages/deck.gl-healpix/src/geometry/compute-geometry.ts \
        packages/deck.gl-healpix/src/geometry/compute-geometry.test.ts \
        packages/deck.gl-healpix/src/geometry/types.ts
```

- [ ] **Step 2: Delete CPU worker**

```bash
git rm packages/deck.gl-healpix/src/workers/tile-grid.worker.ts \
        packages/deck.gl-healpix/src/workers/tile-grid.worker.test.ts
```

- [ ] **Step 3: Delete worker config and mock**

```bash
git rm packages/deck.gl-healpix/src/config.ts \
        packages/deck.gl-healpix/src/__mocks__/worker-code.ts
```

- [ ] **Step 4: Delete old color-frames extension (feature-branch remnants)**

```bash
git rm src/extensions/healpix-color-frames-extension.ts \
        src/extensions/healpix-color-frames-shader-module.ts 2>/dev/null || true
```

Also check if the `src/extensions/` dir or `src/layers/` dir still has leftover feature-branch files:

```bash
ls src/extensions/ src/layers/ src/utils/ src/types/ 2>/dev/null
```

If any `.ts` files remain at `src/` subdirs that aren't in `packages/`, remove them:

```bash
git rm -r src/extensions/ src/layers/ src/utils/ src/types/ src/shaders/ 2>/dev/null || true
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Delete CPU geometry, worker, old color-frames extension, and config"
```

---

## Task 9: Fix `healpixCellIndex` stepMode in `HealpixColorExtension`

The extension registers `healpixCellIndex` as `stepMode: 'vertex'` — but `HealpixCellsPrimitiveLayer` uses instanced rendering (one instance = one cell, 4 vertices). All 4 vertices must share the same cell index, so the step mode must be `'instance'`.

**Files:** `packages/deck.gl-healpix/src/extensions/healpix-color-extension.ts`

- [ ] **Step 1: Apply the stepMode change**

In `healpix-color-extension.ts`, find `initializeState` and change `stepMode: 'vertex'` to `stepMode: 'instance'`:

```typescript
initializeState(this: Layer): void {
  this.getAttributeManager()?.add({
    healpixCellIndex: {
      size: 1,
      type: 'float32',
      stepMode: 'instance',   // was 'vertex'
      accessor: 'healpixCellIndex',
      defaultValue: 0,
      noAlloc: true
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/deck.gl-healpix/src/extensions/healpix-color-extension.ts
git commit -m "Fix healpixCellIndex stepMode to 'instance' for GPU instanced rendering"
```

---

## Task 10: Rewrite `HealpixCellsLayer`

Replace the CPU-geometry + SolidPolygonLayer implementation with GPU instancing via `HealpixCellsPrimitiveLayer` + `HealpixColorExtension`.

**Files:** `packages/deck.gl-healpix/src/layers/healpix-cells-layer.ts`

- [ ] **Step 1: Replace the file content entirely**

Write the following to `packages/deck.gl-healpix/src/layers/healpix-cells-layer.ts`:

```typescript
import {
  CompositeLayer,
  DefaultProps,
  Layer,
  LayerExtension,
  UpdateParameters
} from '@deck.gl/core';
import type { Texture } from '@luma.gl/core';
import { splitCellIds } from '../utils/split-cell-ids';
import { HealpixCellsPrimitiveLayer } from './healpix-cells-primitive-layer';
import { HEALPIX_COLOR_EXTENSION } from '../extensions/healpix-color-extension';
import { resolveFrame, type ResolvedFrame } from '../utils/resolve-frame';
import { packValuesData } from '../utils/values-texture';
import type { CellIdArray } from '../types/cell-ids';
import type {
  HealpixCellsLayerProps,
  HealpixFrameObject
} from '../types/layer-props';

type _HealpixCellsLayerProps = {
  nside: number;
  cellIds: CellIdArray;
  scheme: 'nest' | 'ring';
  values: ArrayLike<number> | null;
  min: number;
  max: number;
  dimensions: 1 | 2 | 3 | 4;
  colorMap: Uint8Array | null;
  frames: HealpixFrameObject[] | null;
  currentFrame: number;
};

type HealpixCellsLayerState = {
  cellIdLo: Uint32Array;
  cellIdHi: Uint32Array;
  cellIndex: Float32Array;
  valuesTexture: Texture | null;
  colorMapTexture: Texture | null;
  valuesTextureWidth: number;
  prevResolved: ResolvedFrame | null;
};

const defaultProps: DefaultProps<_HealpixCellsLayerProps> = {
  nside: { type: 'number', value: 0 },
  cellIds: { type: 'object', value: new Uint32Array(0), compare: true },
  // @ts-expect-error deck.gl DefaultProps has no 'string' type.
  scheme: { type: 'string', value: 'nest' },
  values: { type: 'object', value: null, compare: true },
  min: { type: 'number', value: 0 },
  max: { type: 'number', value: 1 },
  dimensions: { type: 'number', value: 1 },
  colorMap: { type: 'object', value: null, compare: true },
  frames: { type: 'object', value: null, compare: true },
  currentFrame: { type: 'number', value: 0 }
};

export class HealpixCellsLayer extends CompositeLayer<HealpixCellsLayerProps> {
  static layerName = 'HealpixCellsLayer';
  static defaultProps = defaultProps;

  declare state: HealpixCellsLayerState;

  initializeState(): void {
    this.setState({
      cellIdLo: new Uint32Array(0),
      cellIdHi: new Uint32Array(0),
      cellIndex: new Float32Array(0),
      valuesTexture: null,
      colorMapTexture: null,
      valuesTextureWidth: 1,
      prevResolved: null
    });
    this._rebuildAll();
  }

  shouldUpdateState({ changeFlags }: UpdateParameters<this>): boolean {
    return !!changeFlags.propsOrDataChanged;
  }

  updateState({ props }: UpdateParameters<this>): void {
    let resolved: ResolvedFrame;
    try {
      resolved = resolveFrame(props);
    } catch (e) {
      this.raiseError(e as Error, 'HealpixCellsLayer frame resolution failed');
      return;
    }

    const prev = this.state.prevResolved;

    const cellsChanged =
      !prev ||
      resolved.cellIds !== prev.cellIds ||
      resolved.nside !== prev.nside ||
      resolved.scheme !== prev.scheme;

    const valuesChanged =
      !prev ||
      resolved.values !== prev.values ||
      resolved.dimensions !== prev.dimensions ||
      resolved.cellIds.length !== prev.cellIds.length;

    const colorMapChanged = !prev || resolved.colorMap !== prev.colorMap;

    if (cellsChanged) this._splitCells(resolved);
    if (valuesChanged || cellsChanged) this._updateValuesTexture(resolved);
    if (colorMapChanged) this._updateColorMapTexture(resolved);

    this.setState({ prevResolved: resolved });
  }

  finalizeState(): void {
    this.state.valuesTexture?.destroy();
    this.state.colorMapTexture?.destroy();
  }

  renderLayers(): Layer[] {
    const {
      cellIdLo,
      cellIdHi,
      cellIndex,
      valuesTexture,
      colorMapTexture,
      valuesTextureWidth,
      prevResolved
    } = this.state;

    if (!valuesTexture || !colorMapTexture || !prevResolved) return [];

    const { cellIds, nside, scheme, min, max, dimensions } = prevResolved;
    const count = cellIds.length;
    if (count === 0) return [];

    return [
      new HealpixCellsPrimitiveLayer(
        this.getSubLayerProps({
          id: 'cells',
          nside,
          scheme,
          instanceCount: count,
          data: {
            length: count,
            attributes: {
              cellIdLo: { value: cellIdLo, size: 1 },
              cellIdHi: { value: cellIdHi, size: 1 },
              healpixCellIndex: { value: cellIndex, size: 1 }
            }
          },
          valuesTexture,
          colorMapTexture,
          uMin: min,
          uMax: max,
          uDimensions: dimensions,
          uValuesWidth: valuesTextureWidth,
          extensions: [
            ...((this.props.extensions as LayerExtension[]) || []),
            HEALPIX_COLOR_EXTENSION
          ]
        })
      )
    ];
  }

  private _rebuildAll(): void {
    let resolved: ResolvedFrame;
    try {
      resolved = resolveFrame(this.props);
    } catch (e) {
      this.raiseError(e as Error, 'HealpixCellsLayer frame resolution failed');
      return;
    }
    this._splitCells(resolved);
    this._updateValuesTexture(resolved);
    this._updateColorMapTexture(resolved);
    this.setState({ prevResolved: resolved });
  }

  private _splitCells(resolved: ResolvedFrame): void {
    const { cellIds } = resolved;
    if (!cellIds?.length) {
      this.setState({
        cellIdLo: new Uint32Array(0),
        cellIdHi: new Uint32Array(0),
        cellIndex: new Float32Array(0)
      });
      return;
    }
    const { cellIdLo, cellIdHi } = splitCellIds(cellIds);
    const cellIndex = Float32Array.from({ length: cellIds.length }, (_, i) => i);
    this.setState({ cellIdLo, cellIdHi, cellIndex });
  }

  private _updateValuesTexture(resolved: ResolvedFrame): void {
    const { values, dimensions, cellIds } = resolved;
    const cellCount = cellIds.length;
    const oldTexture = this.state.valuesTexture;

    const { maxTextureDimension2D: maxTextureSize } =
      this.context.device.limits;
    const { data, width, height } = packValuesData(
      values,
      dimensions,
      cellCount,
      maxTextureSize
    );

    if (height > maxTextureSize) {
      this.raiseError(
        new Error(
          `Cannot pack ${cellCount} cells in values texture: requires ${width}×${height}, max is ${maxTextureSize}×${maxTextureSize}.`
        ),
        'HealpixCellsLayer values texture dimensions exceeded'
      );
      return;
    }

    const texture = this.context.device.createTexture({
      id: `${this.id}-values`,
      width,
      height,
      dimension: '2d',
      format: 'rgba32float',
      sampler: {
        minFilter: 'nearest',
        magFilter: 'nearest',
        mipmapFilter: 'none',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge'
      }
    });
    texture.copyImageData({ data });

    this.setState({ valuesTexture: texture, valuesTextureWidth: width });
    oldTexture?.destroy();
  }

  private _updateColorMapTexture(resolved: ResolvedFrame): void {
    const { colorMap } = resolved;
    const oldTexture = this.state.colorMapTexture;

    const texture = this.context.device.createTexture({
      id: `${this.id}-colormap`,
      width: 256,
      height: 1,
      dimension: '2d',
      format: 'rgba8unorm',
      sampler: {
        minFilter: 'nearest',
        magFilter: 'nearest',
        mipmapFilter: 'none',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge'
      }
    });
    texture.copyImageData({ data: colorMap });

    this.setState({ colorMapTexture: texture });
    oldTexture?.destroy();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/deck.gl-healpix/src/layers/healpix-cells-layer.ts
git commit -m "Rewrite HealpixCellsLayer: GPU instancing + GPU color, remove CPU geometry"
```

---

## Task 11: Update `types/layer-props.ts` — remove `VERTS_PER_CELL`

`VERTS_PER_CELL` (= 5) was used by the CPU polygon path. It's no longer referenced.

**Files:** `packages/deck.gl-healpix/src/types/layer-props.ts`

- [ ] **Step 1: Remove the constant**

Delete this line from `layer-props.ts`:

```typescript
/** Each HEALPix cell polygon = 4 corners + closing vertex = 5 vertices. */
export const VERTS_PER_CELL = 5;
```

- [ ] **Step 2: Commit**

```bash
git add packages/deck.gl-healpix/src/types/layer-props.ts
git commit -m "Remove VERTS_PER_CELL constant (CPU geometry artifact)"
```

---

## Task 12: Update `package.json` — remove worker export and `healpix-ts` dependency

**Files:** `packages/deck.gl-healpix/package.json`

- [ ] **Step 1: Remove the `./worker` export and `healpix-ts` dependency**

Edit `packages/deck.gl-healpix/package.json`. Change the `exports` block from:

```json
"exports": {
  ".": {
    "import": "./dist/index.mjs",
    "require": "./dist/index.js",
    "types": "./dist/index.d.ts"
  },
  "./worker": "./dist/tile-grid.worker.js"
},
```

to:

```json
"exports": {
  ".": {
    "import": "./dist/index.mjs",
    "require": "./dist/index.js",
    "types": "./dist/index.d.ts"
  }
},
```

And remove `"healpix-ts": "^1.0.0"` from the `dependencies` block (it was only used by the now-deleted worker).

Also remove the `"gen:gpu-shaders"` script if present (it referenced the readback extraction script tied to the old flat structure).

- [ ] **Step 2: Commit**

```bash
git add packages/deck.gl-healpix/package.json
git commit -m "Remove worker export and healpix-ts dep from package.json"
```

---

## Task 13: Update `index.ts` — exports

Remove dead exports (worker config, geometry), add `splitCellIds`.

**Files:** `packages/deck.gl-healpix/src/index.ts`

- [ ] **Step 1: Replace index.ts content**

```typescript
export { HealpixCellsLayer } from './layers/healpix-cells-layer';
export { splitCellIds } from './utils/split-cell-ids';
export { makeColorMap } from './utils/color-map';
export type {
  ColorMapCallbackValue,
  NormalizedColorArray,
  Uint8ColorArray
} from './utils/color-map';
export type { CellIdArray } from './types/cell-ids';
export type {
  HealpixCellsLayerProps,
  HealpixFrameObject,
  HealpixScheme
} from './types/layer-props';
```

(Remove `setWorkerUrl`, `setWorkerFactory` from config — config.ts was deleted in Task 8.)

- [ ] **Step 2: Commit**

```bash
git add packages/deck.gl-healpix/src/index.ts
git commit -m "Update index.ts: add splitCellIds, remove worker/config exports"
```

---

## Task 14: Fix import paths in moved shader/primitive files

After `git mv`, TypeScript imports inside the moved files still use the old relative paths. Check and fix them.

**Files:** `packages/deck.gl-healpix/src/layers/healpix-cells-primitive-layer.ts`, `packages/deck.gl-healpix/src/shaders/index.ts`, shader module

- [ ] **Step 1: Check for broken imports**

```bash
cd packages/deck.gl-healpix && npm run ts-check 2>&1 | head -40
```

Look for `Cannot find module` errors. Common fixes needed:

- `healpix-cells-primitive-layer.ts` imports from `'../shaders'` — should now resolve correctly since shaders moved to same relative path
- Shader files import from sibling files — should resolve correctly since all moved together

- [ ] **Step 2: Fix any broken import paths**

If `ts-check` reports `Cannot find module '../shaders'` in `healpix-cells-primitive-layer.ts`, the import is already correct (both files are now siblings under `packages/.../src/`). If any other path is wrong, update the `from` string to match the new relative location.

If `ts-check` reports `Cannot find module 'virtual:tile-grid-worker'` — this means `config.ts` was not deleted or is still imported. Verify Task 8 completed correctly.

- [ ] **Step 3: Run ts-check until clean**

```bash
cd packages/deck.gl-healpix && npm run ts-check 2>&1
```

Expected: no errors. Fix any remaining import issues before proceeding.

- [ ] **Step 4: Commit any import fixes**

```bash
git add -A
git commit -m "Fix import paths after shader/primitive layer move"
```

---

## Task 15: Run the test suite

**Files:** no changes — verification only.

- [ ] **Step 1: Run tests from monorepo root**

```bash
npm test 2>&1
```

Or from the package directly:

```bash
cd packages/deck.gl-healpix && npm test 2>&1
```

Expected: all tests pass. Tests that should run:
- `split-cell-ids.test.ts` ✓
- `color-map.test.ts` ✓
- `resolve-frame.test.ts` ✓
- `values-texture.test.ts` ✓
- `array-buffer.test.ts` ✓
- `hash.test.ts` ✓

- [ ] **Step 2: Fix any test failures**

If a test fails because it imports a deleted module (e.g. `computeGeometry`, `config`, `color-frame`), the import is in a test file that should have been deleted in Task 8. Delete the offending test file:

```bash
git rm <path-to-test-file>
git commit -m "Remove test for deleted module"
```

If a test fails due to a logic error introduced by the rewrite, fix the source and commit.

- [ ] **Step 3: Confirm all tests pass**

```bash
npm test 2>&1 | tail -20
```

Expected: `Tests: N passed, N total` with no failures.

---

## Task 16: Build the monorepo

**Files:** no changes — verification only.

- [ ] **Step 1: Run the full build**

```bash
npm run build 2>&1
```

Expected: `packages/deck.gl-healpix/dist/` is populated with `index.js`, `index.mjs`, `index.d.ts`.

- [ ] **Step 2: Verify dist output**

```bash
ls packages/deck.gl-healpix/dist/
```

Expected: `index.d.ts  index.js  index.mjs` (no `tile-grid.worker.js`).

- [ ] **Step 3: Fix any build errors**

Common causes:
- Rollup complains about `virtual:tile-grid-worker` — `config.ts` was not deleted or is still referenced. Ensure Task 8 and 12 completed correctly.
- TypeScript errors in shader files — import paths wrong (see Task 14).

- [ ] **Step 4: Commit if any build fixes were needed**

```bash
git add -A
git commit -m "Fix build issues post-merge"
```

---

## Task 17: Final verification commit

- [ ] **Step 1: Confirm clean state**

```bash
git status
npm run ts-check 2>&1 | tail -5
npm test 2>&1 | tail -5
npm run build 2>&1 | tail -5
```

All three commands should show success with no errors.

- [ ] **Step 2: Verify `test/gpu/` readback harness is present**

The GPU readback HTML files (used to visually verify corner positions at nside=1,2,4 in NEST and RING) should be on the branch from the feature side:

```bash
ls test/gpu/
```

Expected: `gpu-readback-nest-equatorial.html`, `gpu-readback-nest-polar.html`, `gpu-readback-ring.html`, `compute-truth.mjs`, `inspect-cell.mjs`, `readback-common.mjs`, `README.md`

If missing (e.g. the directory was accidentally removed), restore from the feature branch:

```bash
git checkout feature/gpu-corners -- test/gpu/
git add test/gpu/
git commit -m "Restore GPU readback test harness from feature branch"
```

- [ ] **Step 3: Tag the branch as merge-complete**

```bash
git log --oneline -10
```

Review the commit history to confirm all tasks landed. The branch is ready to be reviewed or merged to main.
