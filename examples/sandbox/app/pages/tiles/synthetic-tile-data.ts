import { nestDescendants, pix2LonLatNest } from 'healpix-ts';
import type {
  HealpixTileData,
  HealpixTileIndex
} from '@developmentseed/deck.gl-healpix-tile';

export const TILE_NSIDES = [16, 64, 256, 1024];
export const TILE_PARENT_LEVELS = 6;
export const TILE_ZOOM_OFFSET = 5;

const SCALAR_BAND = ['value'];

const HIGHEST_NSIDE = TILE_NSIDES[TILE_NSIDES.length - 1]!;

/**
 * Procedural scalar field, one value per cell at the finest nside in the
 * pyramid. Uses integer harmonics of longitude so the field is continuous
 * across the antimeridian (no seam at lon = ±180°).
 */
function generateBaseLevel(nside: number): Float32Array {
  const npix = 12 * nside * nside;
  const values = new Float32Array(npix);
  const deg2rad = Math.PI / 180;
  for (let cell = 0; cell < npix; cell++) {
    const [lon, lat] = pix2LonLatNest(nside, cell);
    const lonRad = lon * deg2rad;
    values[cell] = 0.5 + 0.5 * Math.sin(3 * lonRad) * Math.cos(lat * 0.03);
  }
  return values;
}

/** Averages each contiguous block of `4^levels` NESTED children into one parent value. */
function downsample(fine: Float32Array, levels: number): Float32Array {
  const blockSize = 4 ** levels;
  const coarse = new Float32Array(fine.length / blockSize);
  for (let i = 0; i < coarse.length; i++) {
    let sum = 0;
    const base = i * blockSize;
    for (let j = 0; j < blockSize; j++) sum += fine[base + j]!;
    coarse[i] = sum / blockSize;
  }
  return coarse;
}

/** Builds the full multiscale pyramid once, from the finest nside down. */
function buildPyramid(): Map<number, Float32Array> {
  const byNside = new Map<number, Float32Array>();
  let finer = generateBaseLevel(HIGHEST_NSIDE);
  byNside.set(HIGHEST_NSIDE, finer);

  for (let i = TILE_NSIDES.length - 2; i >= 0; i--) {
    const nside = TILE_NSIDES[i]!;
    const finerNside = TILE_NSIDES[i + 1]!;
    const levels = Math.round(Math.log2(finerNside / nside));
    finer = downsample(finer, levels);
    byNside.set(nside, finer);
  }

  return byNside;
}

/** Pregenerated once on module load — getTileData only ever slices these arrays. */
const VALUES_BY_NSIDE = buildPyramid();

/** Cells at `dataNside` whose NESTED ancestor at `partitionNside` is `parentCell`. */
function cellsInTile(
  parentCell: number,
  partitionNside: number,
  dataNside: number
): number[] {
  const levelDiff = Math.round(Math.log2(dataNside / partitionNside));
  if (levelDiff < 0) return [];

  // NESTED ordering makes this a contiguous range — no geometric query needed.
  return nestDescendants(parentCell, levelDiff);
}

/** Slices the pregenerated value pyramid for the requested tile. */
export function buildSyntheticTileData(
  index: HealpixTileIndex
): HealpixTileData | null {
  const { x: parentCell, y, z } = index;
  const nside = 1 << z;
  const partitionNside = 1 << y;

  const levelValues = VALUES_BY_NSIDE.get(nside);
  if (!levelValues) return null;

  const cells = cellsInTile(parentCell, partitionNside, nside);
  if (cells.length === 0) return null;

  const cellIds = new Float64Array(cells.length);
  const values = new Float32Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    cellIds[i] = cell;
    values[i] = levelValues[cell]!;
  }

  return { nside, cellIds, values, bands: [...SCALAR_BAND] };
}

/** Small delay so tile requests feel async (and AbortSignal can cancel them). */
export function tileLoadDelay(ms = 40): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
