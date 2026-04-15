// src/geometry/healpix-reference.ts
//
// Reference implementation of HEALPix NEST corner algorithm.
// Mirrors the healpix-ts library approach for validation and later GLSL porting.

const PI_4 = Math.PI / 4;
const PI_2 = Math.PI / 2;

/**
 * Compact (de-interleave) even-positioned bits from a BigInt (Morton decode X).
 * Supports up to 52 bits in the output (sufficient for nside up to 2^26).
 */
function compact1By1(n: bigint): bigint {
  n = n & 0x5555555555555555n;
  n = (n | (n >> 1n)) & 0x3333333333333333n;
  n = (n | (n >> 2n)) & 0x0f0f0f0f0f0f0f0fn;
  n = (n | (n >> 4n)) & 0x00ff00ff00ff00ffn;
  n = (n | (n >> 8n)) & 0x0000ffff0000ffffn;
  n = (n | (n >> 16n)) & 0x00000000ffffffffn;
  return n;
}

/**
 * Convert a NEST cell ID to (f, x, y) face coordinates.
 * f = base pixel index [0..11]
 * x = NE pixel index within face [0..nside-1]
 * y = NW pixel index within face [0..nside-1]
 */
function nest2fxy(
  nside: number,
  cellId: number
): { f: number; x: number; y: number } {
  const nside2 = nside * nside;
  const f = Math.floor(cellId / nside2);
  const k = BigInt(cellId - f * nside2); // Index within base pixel

  // De-interleave Morton code: even bits → x (NE), odd bits → y (NW)
  const x = Number(compact1By1(k));
  const y = Number(compact1By1(k >> 1n));

  return { f, x, y };
}

/**
 * Convert face coordinates (f, x, y) to HEALPix projection coordinates (t, u).
 * t increases eastward, u increases northward.
 */
function fxy2tu(
  nside: number,
  f: number,
  x: number,
  y: number
): { t: number; u: number } {
  const f_row = Math.floor(f / 4); // 0=north cap, 1=equator, 2=south cap
  const f1 = f_row + 2; // Maps to 2, 3, or 4
  const f2 = 2 * (f % 4) - (f_row % 2) + 1; // Horizontal offset [0..7]

  // Diagonal coordinates within base pixel
  const v = x + y; // South-pointing diagonal
  const h = x - y; // East-pointing diagonal

  // Ring index (1 = northernmost ring at this resolution)
  const i = f1 * nside - v - 1;
  // Horizontal position (needs normalization for ring wrapping)
  // +8*nside shifts k by 2π (since t = (k/nside)*π/4), keeping k > 0 so
  // modular normalisation in zaToLonLat is always well-defined.
  const k = f2 * nside + h + 8 * nside;

  // Convert to projection coordinates
  const t = (k / nside) * PI_4;
  const u = PI_2 - (i / nside) * PI_4;

  return { t, u };
}

/**
 * Inverse HEALPix projection: (t, u) → (z, a) where z = sin(lat), a = lon in radians.
 */
function tu2za(t: number, u: number): { z: number; a: number } {
  const abs_u = Math.abs(u);

  if (abs_u >= PI_2) {
    // Out of valid range — return pole
    return { z: Math.sign(u), a: 0 };
  }

  if (abs_u <= PI_4) {
    // Equatorial belt: simple cylindrical projection
    const z = (8 / (3 * Math.PI)) * u;
    const a = t;
    return { z, a };
  } else {
    // Polar caps: inverse of the meridian-squeezing transformation
    const t_t = t % PI_2;
    const a = t - ((abs_u - PI_4) / (abs_u - PI_2)) * (t_t - PI_4);
    // Solve sigma(z) = 4u/π for z, where sigma(z) = 2 - sqrt(3(1-|z|))
    const sigma = (4 * abs_u) / Math.PI;
    const z = Math.sign(u) * (1 - (1 / 3) * (2 - sigma) * (2 - sigma));
    return { z, a };
  }
}

/**
 * Convert (z, a) where z = sin(lat) and a = longitude in radians to [lon_deg, lat_deg].
 */
function zaToLonLat(z: number, a: number): [number, number] {
  const lat = Math.asin(z) * (180 / Math.PI);
  let lon = a * (180 / Math.PI);
  // Normalize to [-180, 180]
  while (lon > 180) lon -= 360;
  while (lon <= -180) lon += 360;
  return [lon, lat];
}

/**
 * Unwrap corner longitudes to form a continuous polygon, using refLon as center.
 * At poles, longitude is undefined — use refLon instead.
 */
function unwrapCornerLon(
  lon: number,
  lat: number,
  refLon: number
): number {
  if (Math.abs(lat) >= 90 - 1e-6) {
    return refLon;
  }
  while (lon - refLon > 180) lon -= 360;
  while (lon - refLon < -180) lon += 360;
  return lon;
}

/**
 * Spread bits of n into even bit positions (inverse of compact1By1).
 * Used for Morton (Z-order) interleaving in ringToNest.
 */
function spread1By1(n: bigint): bigint {
  n = n & 0x00000000ffffffffn;
  n = (n | (n << 16n)) & 0x0000ffff0000ffffn;
  n = (n | (n << 8n)) & 0x00ff00ff00ff00ffn;
  n = (n | (n << 4n)) & 0x0f0f0f0f0f0f0f0fn;
  n = (n | (n << 2n)) & 0x3333333333333333n;
  n = (n | (n << 1n)) & 0x5555555555555555n;
  return n;
}

/** Interleave bits of ix (even positions) and iy (odd positions). */
function morton2d(ix: number, iy: number): number {
  return Number(spread1By1(BigInt(ix)) | (spread1By1(BigInt(iy)) << 1n));
}

/**
 * Convert a RING pixel index to face coordinates (f, x, y).
 * Mirrors the ring2fxy algorithm from healpix-ts.
 */
function ring2fxy(
  nside: number,
  ipix: number
): { f: number; x: number; y: number } {
  const polar_lim = 2 * nside * (nside - 1);

  if (ipix < polar_lim) {
    // NORTH POLAR CAP
    const i = Math.floor((Math.sqrt(1 + 2 * ipix) + 1) / 2);
    const j = ipix - 2 * i * (i - 1);
    const f = Math.floor(j / i);
    const k = j % i;
    const x = nside - i + k;
    const y = nside - 1 - k;
    return { f, x, y };
  }

  if (ipix < polar_lim + 8 * nside * nside) {
    // EQUATORIAL BELT
    const k = ipix - polar_lim;
    const ring = 4 * nside;
    const i = nside - Math.floor(k / ring);
    const s = i % 2 === 0 ? 1 : 0; // even rings are offset by half a pixel
    const j = 2 * (k % ring) + s;
    const jj = j - 4 * nside;
    const ii = i + 5 * nside - 1;
    const pp = (ii + jj) / 2;
    const qq = (ii - jj) / 2;
    const PP = Math.floor(pp / nside);
    const QQ = Math.floor(qq / nside);
    const V = 5 - (PP + QQ);
    const H = PP - QQ + 4;
    const f = 4 * V + ((H >> 1) % 4);
    const x = pp % nside;
    const y = qq % nside;
    return { f, x, y };
  } else {
    // SOUTH POLAR CAP
    const p = 12 * nside * nside - ipix - 1;
    const i = Math.floor((Math.sqrt(1 + 2 * p) + 1) / 2);
    const j = p - 2 * i * (i - 1);
    const f = 11 - Math.floor(j / i);
    const k = j % i;
    const x = i - k - 1;
    const y = k;
    return { f, x, y };
  }
}

/**
 * Convert a RING pixel index to NEST pixel index.
 * Uses healpix-ts ring2fxy algorithm then Morton-encodes (x, y).
 * Valid for nside up to 2^26 (NEST index < 2^53, safe in float64).
 */
export function ringToNest(nside: number, ipring: number): number {
  // At nside=1 the RING and NEST orderings are identical (both are just
  // ipix ∈ {0..11} with the same mapping), so no conversion is needed.
  if (nside === 1) return ipring;
  const { f, x, y } = ring2fxy(nside, ipring);
  return f * nside * nside + morton2d(x, y);
}

/**
 * Return [lon_deg, lat_deg] for corner `cornerIdx` (0..3) of a NEST cell.
 *
 * Corner ordering matches healpix-ts `cornersNestLonLat`:
 *   0 = North  (u + d)
 *   1 = West   (t - d)
 *   2 = South  (u - d)
 *   3 = East   (t + d)
 *
 * where d = π / (4 * nside) is the half-pixel angular size.
 */
export function nestCornerLonLat(
  nside: number,
  cellId: number,
  cornerIdx: number
): [number, number] {
  const { f, x, y } = nest2fxy(nside, cellId);
  const { t, u } = fxy2tu(nside, f, x, y);
  const d = PI_4 / nside; // Half-pixel angular size

  // Compute pixel center longitude for unwrapping
  const { z: z_c, a: a_c } = tu2za(t, u);
  const [refLon] = zaToLonLat(z_c, a_c);

  // Corner offsets in (t, u): [N, W, S, E]
  const dt = [0, -d, 0, d];
  const du = [d, 0, -d, 0];

  const { z, a } = tu2za(t + dt[cornerIdx], u + du[cornerIdx]);
  const [lon, lat] = zaToLonLat(z, a);
  const unwrappedLon = unwrapCornerLon(lon, lat, refLon);

  return [unwrappedLon, lat];
}

/**
 * Return [lon_deg, lat_deg] for corner cornerIdx (0..3) of a RING cell.
 * Converts the RING pixel index to NEST and delegates to nestCornerLonLat.
 */
export function ringCornerLonLat(
  nside: number,
  cellId: number,
  cornerIdx: number
): [number, number] {
  const nestId = ringToNest(nside, cellId);
  return nestCornerLonLat(nside, nestId, cornerIdx);
}
