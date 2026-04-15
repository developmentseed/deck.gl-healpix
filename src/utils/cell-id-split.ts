import type { CellIdArray } from '../types/cell-ids';

export type SplitCellIds = { lo: Uint32Array; hi: Uint32Array };

/**
 * Split a CellIdArray into two Uint32Array buffers (lo and hi 32-bit halves).
 *
 * Float64Array is used for cell IDs > 2^32 (nside > 8192). JS can represent
 * integers exactly up to 2^53, which covers nside=262144 (max id ≈ 8.2e11).
 */
export function splitCellIds(cellIds: CellIdArray): SplitCellIds {
  const n = cellIds.length;
  const lo = new Uint32Array(n);
  const hi = new Uint32Array(n);
  const POW32 = 2 ** 32;
  for (let i = 0; i < n; i++) {
    const id = cellIds[i];
    hi[i] = Math.floor(id / POW32);
    lo[i] = id >>> 0; // equivalent to id % 2^32, handles negatives safely
  }
  return { lo, hi };
}
