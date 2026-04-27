# GPU HEALPix corner computation via xyf2loc

**Date:** 2026-04-16
**Status:** Proposed
**Goal:** Replace the faulty 570-line fp64-emulated vertex shader with a clean ~80-line float32 shader that ports the HEALPix C++ `xyf2loc` algorithm.

---

## Problem

The current GPU shader in `healpix-corners.glsl.ts` is 570 lines of GLSL with inline fp64 emulation, a broken RING→NEST conversion, and unnecessary complexity. It computes corners via an intermediate `(t, u)` projection space with full double-precision arithmetic. The result is fragile, hard to test, and slow.

---

## Solution

Split the work between CPU and GPU at the natural boundary: **cell ID decomposition** (scheme-aware, 64-bit) runs on the CPU using healpix-ts; **corner geometry** (parallel, float32) runs on the GPU using the HEALPix C++ `xyf2loc` algorithm.

```
cellIds + scheme
  → CPU: decomposeCellIds() using healpix-ts nest2fxy / ring2fxy
  → Packed (face, ix, iy) instance attributes
  → GPU: xyf2loc per corner vertex → (z, phi) → (lon°, lat°)
  → deck.gl project_position → gl_Position
```

---

## Constraints

- Both NEST and RING schemes supported (resolved on CPU before GPU upload).
- nside up to 262144 (2^18). Cell IDs up to ~8.2×10^11 (>32 bits) handled by healpix-ts JS numbers (exact to 2^53).
- Float32 throughout the shader. No fp64 emulation.
- 7 decimal places of lon/lat precision at nside ≤ ~50000. At nside 200000+, precision is ~5-6 decimal places (sufficient for sub-pixel rendering accuracy at any zoom level).
- Gap-free rendering: adjacent cells within a face share integer corner grid vertices, producing bit-identical float32 results.

---

## CPU: Cell ID decomposition

### Function: `decomposeCellIds`

**File:** `src/utils/decompose-cell-ids.ts`

**Inputs:** `cellIds: CellIdArray`, `nside: number`, `scheme: HealpixScheme`

**Output:** `{ faceIx: Uint32Array, iy: Uint32Array }`

**Algorithm:**
- For each cell ID:
  - If NEST: call `nest2fxy(nside, cellId)` from healpix-ts
  - If RING: call `ring2fxy(nside, cellId)` from healpix-ts
  - Pack: `faceIx[i] = (face << 18) | ix`
  - Store: `iy[i] = iy_value`

This replaces `splitCellIds` (which produced `cellIdLo`/`cellIdHi`). The healpix-ts functions handle arbitrary JS numbers, so 64-bit cell IDs work transparently.

### Packing format

For nside up to 262144 (2^18):
- `ix` ∈ [0, nside-1]: needs 18 bits
- `iy` ∈ [0, nside-1]: needs 18 bits
- `face` ∈ [0, 11]: needs 4 bits

`faceIx` attribute (uint32): bits [31:18] = face (4 bits used, 10 reserved), bits [17:0] = ix
`iy` attribute (uint32): plain iy value

---

## GPU: Vertex shader

### Instance attributes

| Attribute | Type | Step | Content |
|-----------|------|------|---------|
| `faceIx` | `uint32` | instance | `(face << 18) \| ix` |
| `instIy` | `uint32` | instance | `iy` |

### Uniform (via healpixCells shader module)

| Uniform | Type | Content |
|---------|------|---------|
| `nside` | `uint` | HEALPix resolution parameter |

The `scheme` uniform is removed — scheme conversion happens on the CPU.

### Corner selection

The index buffer is `[0, 1, 2, 0, 2, 3]` (static quad, two triangles). `gl_VertexID % 4` gives corner index 0-3.

Corners map to the four grid vertices of the pixel quad in face coordinates:

| Corner | Name | (cx, cy) |
|--------|------|----------|
| 0 | North | (ix+1, iy+1) |
| 1 | West | (ix, iy+1) |
| 2 | South | (ix, iy) |
| 3 | East | (ix+1, iy) |

This matches the HEALPix C++ `boundaries` function with step=1. The grid vertices are integers, so two adjacent cells sharing an edge compute their common corner from the same integer pair `(cx, cy)`.

### xyf2loc algorithm

Ported from HEALPix C++ `xyf2loc` (`healpix_base.cc` line 1344). Converts normalized face coordinates `(x_norm, y_norm)` and face index to `(z, phi)` where z = cos(colatitude) and phi = azimuth.

**Lookup tables** (12-element constant arrays, from HEALPix paper):
```
jrll = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]
jpll = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7]
```

**Steps:**
1. `x_norm = float(cx) / float(nside)`, `y_norm = float(cy) / float(nside)`
2. `jr = jrll[face] - x_norm - y_norm` (ring parameter, continuous)
3. Three-way branch on `jr`:
   - `jr < 1.0` (north cap): `nr = jr`, `z = 1 - nr²/3`
   - `jr > 3.0` (south cap): `nr = 4 - jr`, `z = nr²/3 - 1`
   - else (equatorial): `nr = 1`, `z = (2 - jr) * 2/3`
4. `tmp = jpll[face] * nr + x_norm - y_norm`
5. Wrap `tmp` to `[0, 8)`: if `< 0` add 8, if `≥ 8` subtract 8
6. `phi = (PI * 0.25 * tmp) / nr` (guard: if `nr < 1e-15`, phi = 0)

### (z, phi) → (lon°, lat°)

```
lat_deg = asin(clamp(z, -1.0, 1.0)) * (180.0 / PI)
lon_deg = phi * (180.0 / PI)
```

Normalize longitude to [-180, 180]: `lon_deg -= 360.0 * floor((lon_deg + 180.0) / 360.0)`

### deck.gl projection

```
vec4 pos = vec4(lon_deg, lat_deg, 0.0, 1.0);
geometry.position = pos;
gl_Position = project_common_position_to_clipspace(project_position(pos));
```

Uses `PI` from deck.gl's project shader module. No other constants declared.

### Fragment shader

Minimal — delegates color to the `DECKGL_FILTER_COLOR` hook:
```glsl
in vec4 vColor;
out vec4 fragColor;
void main() {
  fragColor = vColor;
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
```

---

## Layer changes

### `HealpixCellsPrimitiveLayer`

**Attributes change:**
- Remove: `cellIdLo: uint32`, `cellIdHi: uint32`
- Add: `faceIx: uint32`, `instIy: uint32`

**Shader module change:**
- `healpixCellsShaderModule` keeps `nside: uint`
- Remove `scheme: int` uniform (no longer needed on GPU)

### `HealpixCellsLayer`

- Replace `splitCellIds()` call with `decomposeCellIds()` call
- Pass decomposed buffers as sublayer attributes
- Remove `scheme` from sublayer props (not forwarded to GPU)

### `healpixCellsShaderModule`

Remove `scheme` from the UBO:
```typescript
export type HealpixCellsProps = { nside: number };
// UBO:
// uniform healpixCellsUniforms { uint nside; } healpixCells;
```

---

## Files

| File | Action |
|------|--------|
| `src/shaders/healpix-corners.glsl.ts` | **Rewrite** — replace 570 lines with ~80 lines |
| `src/utils/decompose-cell-ids.ts` | **New** — replaces `cell-id-split.ts` |
| `src/utils/cell-id-split.ts` | **Delete** |
| `src/utils/cell-id-split.test.ts` | **Delete** |
| `src/layers/healpix-cells-layer.ts` | **Modify** — use `decomposeCellIds` |
| `src/layers/healpix-cells-primitive-layer.ts` | **Modify** — new attributes |
| `src/shaders/healpix-cells-shader-module.ts` | **Modify** — remove `scheme` |
| `src/geometry/healpix-reference.ts` | **Keep** — still useful for test validation |
| `src/types/layer-props.ts` | **Keep** — external API unchanged |

---

## Testing

- **Unit tests for `decomposeCellIds`:** verify packed output matches healpix-ts `nest2fxy`/`ring2fxy` for known cell IDs at various nside values (1, 8, 1024, 262144).
- **Reference comparison:** the existing `healpix-reference.ts` stays for validating corner lon/lat against healpix-ts `cornersNestLonLat`/`cornersRingLonLat`. The test confirms the xyf2loc algorithm (implemented identically in TS reference) matches healpix-ts output to within float32 tolerance.
- **Visual regression:** render a low-nside (nside=4) full-sky grid and compare cell shapes against known HEALPix projections.

---

## What gets deleted

From the current shader:
- fp64 emulation functions (`f64_add`, `f64_sub`, `f64_mul`, `f64_div`, `f64_sqrt`, `f64_from`)
- fp64 constants (`F64_PI_4`, `F64_PI_2`, `F64_PI`, `F64_DEG_PER_RAD`, `F64_8_OVER_3PI`)
- Bit manipulation helpers (`uint_log2`, `compact1by1`, `spread1by1`, `morton2d`)
- `nest_to_xyf` (NEST decode moved to CPU)
- `ring_to_nest` (RING decode moved to CPU)
- `fxy2ki`, `ki2tu`, `tu2za` (replaced by `xyf2loc`)
