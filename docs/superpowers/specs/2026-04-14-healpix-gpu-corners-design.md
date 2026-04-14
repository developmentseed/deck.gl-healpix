# GPU-side HEALPix corner computation

**Date:** 2026-04-14
**Goal:** Eliminate the async worker geometry pipeline so cells render in the same frame their data arrives.

---

## Problem

The current pipeline has a mandatory async round-trip before any cell can appear on screen:

```
cellIds → worker pool (healpix-ts + earcut) → geometry buffers → SolidPolygonLayer → GPU
```

The worker pool dispatches message-passing round-trips, and for large cell sets the earcut triangulation adds further delay. The user sees a blank layer until the geometry is ready.

---

## Solution

Replace the geometry pipeline with a custom instanced GPU layer. Cell IDs are uploaded directly as attributes. The vertex shader computes corner positions analytically, using fp64 emulation for precision at high nside values.

```
cellIds → ID split (synchronous, main thread) → HealpixCellsPrimitiveLayer → vertex shader computes corners → GPU
```

---

## Constraints

- Both NEST and RING schemes must be supported.
- nside up to 262144 (2^18) must render correctly. Cell corners at this resolution are ~3.5×10⁻⁵° apart; float32 is insufficient and fp64 emulation is required.
- Cell IDs exceed 32 bits at nside > 8192; 64-bit handling is required in the shader.
- The external props interface (`nside`, `cellIds`, `scheme`, `colorFrames`, `currentFrame`) must not change.

---

## Architecture

### Data flow

1. `cellIds` changes → synchronous split into `cellIdLo` / `cellIdHi` (`Uint32Array` pair) on main thread.
2. Buffers are uploaded to GPU as instance attributes.
3. `HealpixCellsPrimitiveLayer` renders one quad per instance. The vertex shader computes the corner position for each of the 4 vertices from the cell ID and `gl_VertexID % 4`.
4. Color is sampled from the frame texture via `gl_InstanceID` (replaces the `cellVertexIndices` attribute).

### Geometry model

- **Index buffer:** static `[0,1,2, 0,2,3]` repeated per instance — created once at `initializeState`, never recomputed.
- **Vertex buffer:** 4 entries `[0,1,2,3]` (corner indices). `gl_VertexID % 4` selects the corner inside the shader.
- **No earcut.** HEALPix cells are always convex quads; the triangulation is constant.

---

## Vertex shader

### Integer phase (exact)

All cell ID manipulation uses `uvec2` (lo, hi) — no floating point.

- **NEST:** Extract `face` from the upper bits. De-interleave the remaining `2k` bits (where `k = log2(nside)`) into `ix` and `iy` using bitwise operations.
- **RING:** Run ring→nest integer conversion (locate cap/belt region, derive `(ring, iphi)`, reconstruct face coordinates). Then follow the NEST path.
- Apply corner delta: `ix_c = ix + dx[corner]`, `iy_c = iy + dy[corner]` where `dx/dy ∈ {0,1}`.

### fp64 conversion

Convert `ix_c / nside` and `iy_c / nside` to emulated double (hi+lo float32 pair):

```glsl
uint q   = ix_c / nside;          // integer quotient (0 or 1 for corner coords)
uint r   = ix_c - q * nside;      // exact remainder, no overflow risk
float hi = float(q) + float(r) / float(nside);  // coarse value
float lo = (float(r) - (hi - float(q)) * float(nside)) / float(nside); // correction
```

This gives a bit-exact rational representation of the corner face coordinate. The remainder `r` is always `< nside`, so intermediate products stay within uint32 range.

### Angle computation (fp64)

Compute `(theta, phi)` from face coordinates using the HEALPix projection formulas operating on fp64 pairs. Uses deck.gl's existing `fp64_add`, `fp64_mul`, `fp64_sqrt` utilities from `@luma.gl/shadertools` — no new fp64 primitives needed.

### Output

Convert `(theta, phi)` to `(lon, lat)` fp64 pairs. Pass to deck.gl's `project_position_fp64`. Projection proceeds identically to built-in layers.

---

## Color frames extension

`healpixCellIndex` attribute (previously a `Uint32Array` with every 5 vertices sharing the same index) is removed. The color lookup in `VERTEX_COLOR_FILTER_INJECT` is updated to use `gl_InstanceID` instead. All other extension logic (texture binding, `frameIndex` uniform, texel fetch) is unchanged.

---

## Composite layer changes (`HealpixCellsLayer`)

**Removed:**
- `_buildGeometry()` and the worker pipeline
- `computeGeometry` import
- `coords`, `indexes`, `triangles`, `cellVertexIndices` state fields
- `_version` stale-result guard
- `SolidPolygonLayer` sublayer

**Added to state:**
- `cellIdLo: Uint32Array | null`
- `cellIdHi: Uint32Array | null`

These are computed synchronously in `updateState` when `cellIds`, `nside`, or `scheme` changes. The split is a single typed-array pass — O(n), no async.

**Unchanged:**
- `_buildTextureData`, `_updateColorTexture`
- `frameTexture`, `frameCount`, `cellTextureWidth` state
- External props interface

---

## New file: `HealpixCellsPrimitiveLayer`

A deck.gl `Layer` subclass (not composite). Owns the GPU model directly.

**Attributes (instance-stepped):**
- `cellIdLo: uint32`
- `cellIdHi: uint32`

**Uniforms:**
- `nside: uint32`
- `scheme: int` (0 = NEST, 1 = RING)

**Shaders:**
- `vs`: corner computation as described above
- `fs`: minimal, delegates color to `DECKGL_FILTER_COLOR` hook (same pattern as `SolidPolygonLayer`)

---

## Files affected

| File | Change |
|------|--------|
| `src/layers/healpix-cells-layer.ts` | Remove geometry pipeline; add ID splitting; swap sublayer to `HealpixCellsPrimitiveLayer` |
| `src/layers/healpix-cells-primitive-layer.ts` | New file — custom instanced layer + shaders |
| `src/extensions/healpix-color-frames-extension.ts` | Swap `healpixCellIndex` attribute for `gl_InstanceID` |
| `src/geometry/` | Entire directory removed |
| `src/workers/` | Entire directory removed |
| `src/utils/worker-pool.ts` | Removed |

---

## Known limitations

- fp64 emulation adds shader complexity and a modest GPU ALU cost. For typical rendering workloads this is negligible, but it is not free.
- The RING→NEST integer conversion in GLSL is the most complex shader code in the system. It must be validated against the reference healpix-ts output for all three HEALPix regions (north cap, equatorial belt, south cap).
- Ultra-high nside (> 262144) is out of scope for this design.
