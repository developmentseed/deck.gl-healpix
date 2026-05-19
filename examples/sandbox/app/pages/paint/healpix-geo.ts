import {
  cornersNestLonLat,
  cornersRingLonLat,
  lonLat2PixNest,
  lonLat2PixRing,
  pix2LonLatNest,
  pix2LonLatRing
} from 'healpix-ts';

import { dedupeCellLinesById, type CellLine } from './colored-cells';
import type { HealpixScheme } from './types';

export function lonLatToCell(
  nside: number,
  lon: number,
  lat: number,
  scheme: HealpixScheme
): number {
  return scheme === 'nest'
    ? lonLat2PixNest(nside, lon, lat)
    : lonLat2PixRing(nside, lon, lat);
}

export function cellToLonLat(
  nside: number,
  cell: number,
  scheme: HealpixScheme
): [number, number] {
  const [lon, lat] =
    scheme === 'nest'
      ? pix2LonLatNest(nside, cell)
      : pix2LonLatRing(nside, cell);
  return [lon, lat];
}

export function cellCorners(
  nside: number,
  cell: number,
  scheme: HealpixScheme
): [number, number][] {
  return scheme === 'nest'
    ? cornersNestLonLat(nside, cell)
    : cornersRingLonLat(nside, cell);
}

/** Preserve geographic coverage when nside or scheme changes. */
export function remapCellsToNside(
  cells: number[],
  fromNside: number,
  toNside: number,
  fromScheme: HealpixScheme,
  toScheme: HealpixScheme
): number[] {
  if (
    cells.length === 0 ||
    (fromNside === toNside && fromScheme === toScheme)
  ) {
    return cells;
  }

  const next = new Set<number>();
  for (const cell of cells) {
    const [lon, lat] = cellToLonLat(fromNside, cell, fromScheme);
    next.add(lonLatToCell(toNside, lon, lat, toScheme));
  }
  return [...next];
}

export function remapCellLinesToNside(
  lines: CellLine[],
  fromNside: number,
  toNside: number,
  fromScheme: HealpixScheme,
  toScheme: HealpixScheme
): CellLine[] {
  if (
    lines.length === 0 ||
    (fromNside === toNside && fromScheme === toScheme)
  ) {
    return lines;
  }

  const remapped = lines.map((line) => {
    if (line.id === null) return line;
    const [lon, lat] = cellToLonLat(fromNside, line.id, fromScheme);
    const newId = lonLatToCell(toNside, lon, lat, toScheme);
    return { ...line, id: newId };
  });

  return dedupeCellLinesById(remapped);
}
