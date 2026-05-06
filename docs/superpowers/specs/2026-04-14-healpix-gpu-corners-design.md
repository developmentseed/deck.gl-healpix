# GPU-side HEALPix corner computation

**Date:** 2026-04-14
**Status:** Implemented on `feature/gpu-corners`
**Goal:** Eliminate the async worker geometry pipeline so cells render in the same frame their data arrives.

---

## Problem

The previous pipeline had a mandatory async round-trip before any cell could appear on screen:

```
cellIds → worker pool (healpix-ts + earcut) → geometry buffers → SolidPolygonLayer → GPU
```

The worker pool dispatched message-passing round-trips, and for large cell sets the earcut triangulation added further delay. The user saw a blank layer until the geometry was ready.

---

## Solution

The geometry pipeline was replaced with a custom instanced GPU layer. Cell IDs are uploaded directly as attributes. The vertex shader computes corner positions analytically, using fp64 emulation for precision at high nside values.

```
cellIds → ID split (synchronous, main thread) → HealpixCellsPrimitiveLayer → vertex shader computes corners → GPU
```

---

## Constraints

- Both NEST and RING schemes are supported.
- nside up to 262144 (2^18) renders correctly under NEST. Cell corners at this resolution are ~3.5×10⁻⁵° apart; float32 is insufficient and fp64 emulation is used throughout.
- Cell IDs exceed 32 bits at nside > 8192; 64-bit handling is implemented in the shader via `uvec2` (lo, hi) pairs.
- The external props interface (`nside`, `cellIds`, `scheme`, `colorFrames`, `currentFrame`) is unchanged.

---

## Architecture

### Data flow

1. `cellIds` changes → synchronous split into `cellIdLo` / `cellIdHi` (`Uint32Array` pair) on main thread.
2. Buffers are uploaded to GPU as instance attributes.
3. `HealpixCellsPrimitiveLayer` renders one quad per instance. The vertex shader computes the corner position for each of the 4 vertices from the cell ID and `gl_VertexID % 4`.
4. Color is sampled from the frame texture via `gl_InstanceID`.

### Geometry model

- **Index buffer:** static `[0,1,2, 0,2,3]` — created once at `initializeState`, never recomputed.
- **Corner selection:** `gl_VertexID % 4` selects the corner inside the shader.
- **No earcut.** HEALPix cells are always convex quads; the triangulation is constant.

---

## Vertex shader

The shader uses a **(t, u) projection-space** approach rather than directly computing (theta, phi) from face coordinates. This avoids transcendental functions (asin, atan) in fp64 and keeps the critical path in rational arithmetic.

### Integer phase (exact)

All cell ID manipulation uses `uvec2` (lo, hi) — no floating point.

- **NEST:** Extract `face` from the upper bits. De-interleave the remaining `2k` bits (where `k = log2(nside)`) into `ix` and `iy` using bitwise Morton decoding (`compact1by1`).
- **RING:** Convert ring pixel index → NEST pixel index via integer arithmetic (north cap / equatorial belt / south cap regions handled separately with 64-bit comparisons). Then follow the NEST path.

### Projection via (t, u)

From face coordinates `(f, ix, iy)`, compute the HEALPix projection coordinates:

```
i = f1 * nside - (ix + iy) - 1     (ring index)
k = f2 * nside + (ix - iy) + 8*nside   (horizontal index)
t = (k / nside) * π/4              (fp64)
u = π/2 - (i / nside) * π/4        (fp64)
```

Corner offsets are applied as `±π / (4 * nside)` in the (t, u) plane (N/W/S/E diamond corners).

### Inverse projection: (t, u) → (z, a) → (lon, lat)

The inverse HEALPix projection converts (t, u) to (z, a) where z = cos(θ) and a = φ:
- **Equatorial belt** (|u| ≤ π/4): z = (8/3π) · u, a = t
- **Polar caps** (|u| > π/4): σ = 4|u|/π, z = sign(u) · (1 - ⅓(2-σ)²), with longitude correction for the polar facet boundaries.

Finally, `lat = asin(z)` and `lon = a` are converted to degrees and passed to deck.gl's `project_position` → `project_common_position_to_clipspace`.

### fp64 emulation

Self-contained fp64 arithmetic implemented inline (not using luma.gl's fp64 shader module):
- **Two-sum** (`f64_add`): Knuth exact addition
- **Veltkamp-Dekker** (`f64_mul`): Exact multiplication via operand splitting
- **Newton-Raphson** (`f64_div`, `f64_sqrt`): Refined from float32 seed

---

## Color frames extension

The `healpixCellIndex` per-vertex attribute was removed. The color lookup in `DECKGL_FILTER_COLOR` uses `gl_InstanceID` directly (one instance = one cell). All other extension logic (texture binding, `frameIndex` uniform, texel fetch) is unchanged.

---

## Shader modules

Two UBO-based shader modules manage uniforms:

- **`healpixCellsShaderModule`** — `nside` (uint) and `scheme` (int), set via `model.shaderInputs.setProps()` each draw call.
- **`healpixColorFramesShaderModule`** — `frameIndex` (int) and `cellTextureWidth` (int), set by the color frames extension.

---

## Composite layer (`HealpixCellsLayer`)

**Removed:**
- `_buildGeometry()` and the worker pipeline
- `computeGeometry`, `SolidPolygonLayer`, `expandArrayBuffer` imports
- `coords`, `indexes`, `triangles`, `cellVertexIndices` state fields
- `_version` stale-result guard

**Added:**
- `_splitCellIds()` — synchronous O(n) cell ID split into `cellIdLo` / `cellIdHi` (Uint32Array)
- `HealpixCellsPrimitiveLayer` sublayer with instanced rendering

**Unchanged:**
- `_buildTextureData`, `_updateColorTexture`
- `frameTexture`, `frameCount`, `cellTextureWidth` state
- External props interface

---

## Primitive layer (`HealpixCellsPrimitiveLayer`)

A deck.gl `Layer` subclass (not composite). Owns the luma.gl `Model` directly.

**Attributes (instance-stepped):**
- `cellIdLo: uint32`
- `cellIdHi: uint32`

**Uniforms (via `healpixCellsShaderModule` UBO):**
- `nside: uint`
- `scheme: int` (0 = NEST, 1 = RING)

**Shaders:**
- `vs`: corner computation as described above (`healpix-corners.glsl.ts`)
- `fs`: minimal, delegates color to `DECKGL_FILTER_COLOR` hook

---

## Files

| File | Status |
|------|--------|
| `src/layers/healpix-cells-layer.ts` | Modified — synchronous ID splitting, `HealpixCellsPrimitiveLayer` sublayer |
| `src/layers/healpix-cells-primitive-layer.ts` | New — custom instanced layer |
| `src/shaders/healpix-corners.glsl.ts` | New — GLSL vertex + fragment shaders with fp64 |
| `src/shaders/healpix-cells-shader-module.ts` | New — UBO shader module for nside/scheme |
| `src/extensions/healpix-color-frames-extension.ts` | Modified — `gl_InstanceID` replaces `healpixCellIndex` |
| `src/utils/cell-id-split.ts` | New — 64-bit cell ID splitting utility |
| `src/geometry/healpix-reference.ts` | New — TS reference for NEST corners + RING→NEST (test-only) |
| `src/geometry/compute-geometry.ts` | Deleted |
| `src/geometry/types.ts` | Deleted |
| `src/workers/` | Deleted (entire directory) |
| `src/utils/worker-pool.ts` | Deleted |
| `src/utils/hash.ts` | Deleted |
| `src/config.ts` | Deleted |

---

## Known limitations

- fp64 emulation adds shader complexity and a modest GPU ALU cost. For typical rendering workloads this is negligible, but it is not free.
- The RING→NEST conversion in GLSL uses float32 intermediate arithmetic for ring index reconstruction. At nside > ~8192, polar cap and equatorial belt pixel indices exceed float32's 24-bit mantissa, causing potential off-by-one errors in the ring/face decode. The NEST path is fully fp64-correct at all nside values. A follow-up could extend fp64 emulation to the RING integer math for full high-nside RING support.
- Ultra-high nside (> 262144) is out of scope.
