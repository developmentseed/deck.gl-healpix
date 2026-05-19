import { nside2resol } from 'healpix-ts';
import type { Map as MaplibreMap } from 'maplibre-gl';

import { cellCorners } from './healpix-geo';
import type { HealpixScheme } from './types';

const LABEL_FONT_SIZE = 14;
const PX_PER_CHAR = 7;
const MIN_LABEL_PX = 20;

function estimatedLabelWidthPx(cellId: number): number {
  return Math.max(MIN_LABEL_PX, String(cellId).length * PX_PER_CHAR);
}

/**
 * Smallest map zoom (Mercator) at which a cell ID string fits inside the cell,
 * estimated at the given latitude. Higher nside → higher required zoom.
 */
export function minZoomForCellLabel(
  nside: number,
  cellId: number,
  latitude: number
): number {
  const cellDiameterDeg = ((nside2resol(nside) * Math.SQRT2) / Math.PI) * 180;
  const minPx = estimatedLabelWidthPx(cellId);
  const cosLat = Math.max(0.01, Math.cos((latitude * Math.PI) / 180));
  const zoom = Math.log2((minPx * 360) / (512 * cellDiameterDeg * cosLat));
  return Number.isFinite(zoom) ? zoom : Infinity;
}

/** Pixel span of a cell on screen using projected corners. */
export function cellSizePixels(
  map: MaplibreMap,
  nside: number,
  cell: number,
  scheme: HealpixScheme
): number {
  const corners = cellCorners(nside, cell, scheme);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [lon, lat] of corners) {
    const { x, y } = map.project([lon, lat]);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  return Math.min(maxX - minX, maxY - minY);
}

export function cellFitsLabel(
  map: MaplibreMap,
  nside: number,
  cell: number,
  scheme: HealpixScheme
): boolean {
  const sizePx = cellSizePixels(map, nside, cell, scheme);
  return sizePx >= estimatedLabelWidthPx(cell);
}

export function filterCellsWithVisibleLabels(
  map: MaplibreMap | undefined,
  cells: number[],
  nside: number,
  scheme: HealpixScheme,
  zoom: number,
  latitude: number
): number[] {
  if (cells.length === 0) return [];

  if (map) {
    return cells.filter((cell) => cellFitsLabel(map, nside, cell, scheme));
  }

  return cells.filter(
    (cell) => zoom >= minZoomForCellLabel(nside, cell, latitude)
  );
}

export { LABEL_FONT_SIZE };
