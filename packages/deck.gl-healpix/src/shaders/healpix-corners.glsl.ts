/**
 * Corner-expansion math: (face, ix, iy, ci, nside) → (lon_rad_fp, lat_rad_fp).
 *
 * Takes a pixel (ix, iy) plus a corner index ci ∈ {0..3} (N/W/S/E) and emits
 * the spherical lon/lat for that corner in fp64 (vec2 = (hi, lo)).
 *
 * Corner delivery is anchored: k_anchor (the cell's SW corner, ci=2) is
 * reduced once to (-4·nside, 4·nside], then each corner rides along at
 * k_anchor + dk with dk ∈ {-1, 0, +1}. All four corners of a cell stay
 * within ±1 of each other in k-space, so quads straddling the antimeridian
 * render as tight polygons with at most one corner sitting just past ±π.
 *
 * Uses fxy2tu → tu2za composition. Inner branches:
 *   - polar cap   (|u| > π/4): half-angle asin identity + Newton refinement
 *   - equatorial  (|u| ≤ π/4): direct z = (8/3π)·u, asin + Newton refinement
 *   - exact pole  (|u| ≥ π/2): lat = ±π/2, lon = cell-center lon (via k_anchor)
 *
 * Depends on fp64.glsl.ts for the Dekker primitives and π constants.
 */
export const HEALPIX_CORNERS_GLSL: string = /* glsl */ `
void fxyCorner(
  int face, int ix, int iy, int ci, int nside,
  out vec2 lon_rad_fp, out vec2 lat_rad_fp
) {
  // integer fxy2tu (exact)
  int f_row = face / 4;
  int f1 = f_row + 2;
  int f2 = 2 * (face - 4 * f_row) - (f_row & 1) + 1;

  // Per-corner deltas from the pixel's (ix, iy) anchor (= the ci=2 / SW
  // corner). Taking (cx, cy) = (ix + {0,1}, iy + {0,1}) through the no-(-1)
  // fxy2tu formula below gives:
  //   ci=0 (N, cx=ix+1, cy=iy+1):  di = -2, dk =  0
  //   ci=1 (W, cx=ix,   cy=iy+1):  di = -1, dk = -1
  //   ci=2 (S, cx=ix,   cy=iy  ):  di =  0, dk =  0
  //   ci=3 (E, cx=ix+1, cy=iy  ):  di = -1, dk = +1
  // (Intentionally omits the -1 that healpix-ts fxy2tu has — that offset is
  // for pixel *centers*; we want corners of pixel (ix, iy), so going through
  // integer cx/cy and this formula yields N/W/S/E exactly. Adding the -1 back
  // would shift every corner half a pixel north.)
  int di = (ci == 0) ? -2 : ((ci == 2) ? 0 : -1);
  int dk = (ci == 1) ? -1 : ((ci == 3) ? 1 : 0);

  int i_anchor = f1 * nside - ix - iy;
  int k_anchor = f2 * nside + (ix - iy) + 8 * nside;

  // Wrap the cell anchor's k_ring once to (-4·nside, 4·nside]. Every corner
  // then rides along as k_anchor + dk (dk ∈ {-1, 0, +1}), so the four
  // corners of a cell stay within ±1 of each other in k-space. A cell
  // crossing the antimeridian has one corner sitting just past ±π and the
  // rest just inside — deck.gl's Mercator draws that as a tight quad
  // spanning the dateline.
  //
  // Since 8·nside · π/(4·nside) = 2π *exactly*, the wrap is bit-exact. It
  // keeps t_fp bounded near the anchor, avoiding the catastrophic
  // cancellation we'd see if t_fp grew to ~12 rad before being reduced to
  // ~0.16 rad.
  int period = 8 * nside;
  k_anchor = k_anchor - (k_anchor / period) * period;
  if (k_anchor > 4 * nside) k_anchor -= period;

  int k_ring = k_anchor + dk;
  int i_ring = i_anchor + di;

  // Split k_ring = k_int * nside + k_rem. nside is a power of two so
  // k_rem / nside is exact in fp32.
  int k_int = k_ring / nside;
  int k_rem = k_ring - k_int * nside;
  int i_int = i_ring / nside;
  int i_rem = i_ring - i_int * nside;
  float k_frac = float(k_rem) / float(nside);
  float i_frac = float(i_rem) / float(nside);

  // t = (k_int + k_frac) * PI/4  in fp64
  vec2 t_fp = _mul64f(PI4_64, float(k_int));
  t_fp      = _add64(t_fp, _mul64f(PI4_64, k_frac));

  vec2 i_ang = _mul64f(PI4_64, float(i_int));
  i_ang      = _add64(i_ang, _mul64f(PI4_64, i_frac));
  vec2 u_fp  = _sub64(PI2_64, i_ang);

  // tu2za ∘ asin composed in fp64: each branch emits lat_rad_fp / lon_rad_fp
  // directly. Structuring it this way lets the polar branch sidestep asin's
  // catastrophic ULP amplification near z=1 (at lat≈85° the naive chain turns
  // a 1-ULP fp32 error in z into ~16 ULPs in lat because d(asin)/dz = sqrt(3)/|s|).
  float u_hi  = u_fp.x;
  float abs_u = abs(u_hi);

  if (abs_u >= PI2_64.x) {
    // Exact pole: lat = ±π/2 with full fp64 residual. All meridians meet at
    // the pole so lon is geometrically arbitrary, but the four corners of
    // a pole cell need a single agreed lon to draw a proper wedge. Use the
    // cell center's lon: k_anchor · π/(4·nside). k_anchor is the center's
    // k — the ±0.5 pixel offsets in cx/cy cancel in the k = cx - cy
    // formula, so the diamond's midpoint sits at (k_anchor, i_anchor - 1).
    float sgn = sign(u_hi);
    lat_rad_fp = vec2(sgn * PI2_64.x, sgn * PI2_64.y);

    int kc_int = k_anchor / nside;
    int kc_rem = k_anchor - kc_int * nside;
    float kc_frac = float(kc_rem) / float(nside);
    vec2 t_center = _mul64f(PI4_64, float(kc_int));
    t_center      = _add64(t_center, _mul64f(PI4_64, kc_frac));
    lon_rad_fp = t_center;
  } else if (abs_u <= PI4_64.x) {
    // Equatorial: z = (8/3π)·u in fp64, a = t in fp64, then asin(z) with
    // one Newton step (GLSL spec: asin ≤ 4 ULPs, sin/cos ≤ 4 ULPs each).
    //   lat_new = lat_old - (sin(lat_old) - z_true) / cos(lat_old)
    // where z_true = z_hi + z_lo. |u| ≤ π/4 ⇒ |lat| ≤ arcsin(2/3) ≈ 41.8°
    // so cos_lat ≥ 0.745 — no pole guard needed in this branch.
    vec2 three_pi  = _mul64f(PI64, 3.0);
    vec2 k_eq      = _div64(vec2(8.0, 0.0), three_pi);
    vec2 z_fp      = _mul64(k_eq, u_fp);
    lon_rad_fp     = t_fp;

    float z_hi     = clamp(z_fp.x, -1.0, 1.0);
    float lat_hi_0 = _seal(asin(z_hi));
    float cos_lat0 = cos(lat_hi_0);
    float sin_lat0 = sin(lat_hi_0);
    float r        = (sin_lat0 - z_hi) - z_fp.y;
    float lat_hi   = _seal(lat_hi_0 - r / cos_lat0);
    float sin_lat  = sin(lat_hi);
    float cos_lat  = cos(lat_hi);
    float r2       = (sin_lat - z_hi) - z_fp.y;
    float lat_lo   = -r2 / cos_lat;
    lat_rad_fp     = vec2(lat_hi, lat_lo);
  } else {
    // Polar cap. Canonical tu2za formula:
    //   s = 2 - 4|u|/π         (|s| ≤ 1, shrinks to 0 at the pole)
    //   z = sign(u)·(1 - s²/3)
    //   a = t - ((|u|-π/4)/(|u|-π/2))·((t mod π/2) - π/4)
    //
    // Computing z then asin(z) is cursed: near z=1 we have
    //   d(asin)/dz = 1/sqrt(1-z²) = sqrt(3)/|s|
    // so the 1 fp32 ULP of noise from forming (1 - s²/3) gets blown up by
    // 1/|s| — ~16× at lat 85°, way past the 4-ULP spec budget for asin.
    //
    // Fix: use the half-angle identity
    //   asin(1 - 2w²) = π/2 - 2·asin(w)      (0 ≤ w ≤ 1)
    // Pick w so 2w² = s²/3, i.e. w = |s|/sqrt(6). Then:
    //   |lat| = π/2 - 2·asin(w)    →    lat = sign(u)·|lat|
    // For |s| ≤ 1 → w ≤ 0.4082 so θ = asin(w) ≤ 0.421 rad, giving
    // cos(θ) ≥ 0.91 — Newton on sin(θ) - w = 0 is well-conditioned here
    // (unlike at the pole itself where cos(lat)→0).
    //
    // asin refinement (Plan B):
    //   θ₀ = asin(w)                              GLSL spec: 4 ULP on θ
    //   θ_hi = θ₀ - (sin(θ₀) - w) / cos(θ₀)       one Newton step → ≲ sin-spec noise
    //   θ_lo = -(sin(θ_hi) - w) / cos(θ_hi)       residual captured as Dekker lo
    // δ = 2·asin(w) then trivially becomes (2·θ_hi, 2·θ_lo) — a power-of-2
    // scale is exact in fp32 so the Dekker pair scales componentwise.
    float sgn = sign(u_hi);
    float s   = 2.0 - 4.0 * abs_u / PI64.x;
    const float INV_SQRT_6 = 0.40824829046386; // 1/sqrt(6), rounded to fp32
    float w    = abs(s) * INV_SQRT_6;
    // Seal asin outputs so the compiler can't simplify sin(asin(w)) ≡ w and
    // collapse the Newton correction to 0. Same trick as in the Dekker
    // primitives: bitcast round-trip is an opaque identity.
    float a0   = _seal(asin(w));
    float a_hi = _seal(a0 - (sin(a0) - w) / cos(a0));
    float a_lo = -(sin(a_hi) - w) / cos(a_hi);

    vec2 delta_fp   = vec2(2.0 * a_hi, 2.0 * a_lo);
    vec2 lat_mag_fp = _sub64(PI2_64, delta_fp);
    lat_rad_fp      = vec2(sgn * lat_mag_fp.x, sgn * lat_mag_fp.y);

    // lon: the polar a-formula involves a division of small differences near
    // the pole, but t itself is well-separated from the knee at |u|=π/4,
    // so fp32 here is sufficient. (Empirically the bigger ULPs at the pole
    // are all in lat, not lon.)
    float t_hi = t_fp.x;
    float t_t  = mod(t_hi, PI2_64.x);
    float a_f  = t_hi - ((abs_u - PI4_64.x) / (abs_u - PI2_64.x))
                         * (t_t - PI4_64.x);
    lon_rad_fp = vec2(a_f, 0.0);
  }

  // lon_rad lies in (-π - π/(4·nside), π + π/(4·nside)]. A cell straddling
  // the antimeridian has its E or W corner sitting just past ±π, which
  // deck.gl's Mercator handles fine. No Dekker subtraction of 2π is needed
  // — that would introduce cancellation noise we can't afford.
}
`;
