export interface ParentRowRange {
  rowStart: number;
  rowEnd: number;
}

/**
 * Returns the largest value in `available` that is <= `target`,
 * or the smallest available value if target is below all options.
 */
export function clampToAvailable(target: number, available: number[]): number {
  const sorted = [...available].sort((a, b) => a - b);
  let result = sorted[0];
  for (const v of sorted) {
    if (v <= target) result = v;
    else break;
  }
  return result;
}

/**
 * Returns the HEALPix nside for a given deck.gl zoom level.
 * Formula: nside = 2^round(zoom + zoomOffset), clamped to available nsides.
 */
export function getNsideForZoom(
  zoom: number,
  zoomOffset: number,
  available: number[]
): number {
  const raw = Math.pow(2, Math.round(zoom + zoomOffset));
  return clampToAvailable(raw, available);
}

/**
 * Decode a 2-element slice [offsets[p], offsets[p+1]] from parent_offsets CSR array.
 * Returns null when the tile is empty (rowStart >= rowEnd) or pair is too short.
 */
export function rowRangeFromOffsetPair(
  pair: ArrayLike<bigint | number>
): ParentRowRange | null {
  if (pair.length < 2) return null;
  const rowStart = Number(pair[0]);
  const rowEnd = Number(pair[1]);
  if (rowStart >= rowEnd) return null;
  return { rowStart, rowEnd };
}
