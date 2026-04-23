/**
 * Main vertex-shader glue: attributes + main().
 * Prepended by int64, fp64, healpix-decompose, healpix-corners in shaders/index.ts.
 */
export const HEALPIX_CELLS_VS_MAIN: string = /* glsl */ `
in uint cellIdLo;
in uint cellIdHi;
in vec3 positions;

out vec4 vColor;

void main() {
  uvec2 cellId = uvec2(cellIdLo, cellIdHi);

  uvec3 fxy;
  if (healpixCells.scheme == 0u) {
    fxy = decodeNest(cellId, healpixCells.log2nside);
  } else {
    fxy = decodeRing(
      cellId,
      healpixCells.nside,
      healpixCells.polarLim,
      healpixCells.eqLim,
      healpixCells.npix
    );
  }
  int face = int(fxy.x);
  int ix = int(fxy.y);
  int iy = int(fxy.z);

  int ci = gl_VertexID % 4;

  // Pass (ix, iy, ci) so fxyCorner can wrap the cell's k-anchor once and
  // let each corner ride along as k_anchor + dk (dk ∈ {-1, 0, +1}). Keeps
  // the quad tight in lon even when the cell crosses the antimeridian.
  vec2 lon_rad_fp, lat_rad_fp;
  fxyCorner(face, ix, iy, ci, int(healpixCells.nside), lon_rad_fp, lat_rad_fp);

  vec2 deg_per_rad = _div64(vec2(180.0, 0.0), PI64);
  vec2 lat_deg_fp  = _mul64(lat_rad_fp, deg_per_rad);
  vec2 lon_deg_fp  = _mul64(lon_rad_fp, deg_per_rad);

  vec3 pos_hi = vec3(lon_deg_fp.x, lat_deg_fp.x, 0.0);
  vec3 pos_lo = vec3(lon_deg_fp.y, lat_deg_fp.y, 0.0);
  gl_Position = project_position_to_clipspace(
    pos_hi, pos_lo, vec3(0.0), geometry.position
  );

  vColor = vec4(1.0);
  DECKGL_FILTER_COLOR(vColor, geometry);
}
`;
