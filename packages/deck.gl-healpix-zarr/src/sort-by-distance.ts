import { pix2LonLatNest } from 'healpix-ts';
import type { HealpixTileIndex } from './types';

/** Squared lon/lat distance in degrees (shortest longitude arc). */
export function lonLatDistanceSq(
  lonA: number,
  latA: number,
  lonB: number,
  latB: number
): number {
  let dLon = lonA - lonB;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const dLat = latA - latB;
  return dLon * dLon + dLat * dLat;
}

/** Viewport focal point in degrees, or bbox midpoint when lon/lat are absent. */
export function viewportCenterLonLat(viewport: {
  getBounds(): [number, number, number, number];
  longitude?: number;
  latitude?: number;
}): [number, number] {
  const lon = viewport.longitude ?? NaN;
  const lat = viewport.latitude ?? NaN;
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    return [lon, lat];
  }
  const [west, south, east, north] = viewport.getBounds();
  return [(west + east) / 2, (south + north) / 2];
}

/**
 * Reorders tile indices by increasing distance from the viewport center.
 * Uses each tile's own partition nside (derived from index.y as 2^y) rather
 * than a shared partition nside, so mixed-LOD tile sets are sorted correctly.
 */
export function sortTileIndicesByViewportCenter(
  indices: HealpixTileIndex[],
  viewport: {
    getBounds(): [number, number, number, number];
    longitude?: number;
    latitude?: number;
  }
): HealpixTileIndex[] {
  if (indices.length <= 1) return indices;

  const [centerLon, centerLat] = viewportCenterLonLat(viewport);
  return indices
    .map((index) => {
      const [lon, lat] = pix2LonLatNest(1 << index.y, index.x);
      return {
        index,
        dist: lonLatDistanceSq(lon, lat, centerLon, centerLat)
      };
    })
    .sort((a, b) => a.dist - b.dist)
    .map(({ index }) => index);
}
