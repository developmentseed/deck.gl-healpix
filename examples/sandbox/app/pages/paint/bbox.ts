import type { BBox } from 'healpix-ts';

/**
 * Closed lon/lat ring for deck.gl PathLayer.
 *
 * When the bbox crosses the antimeridian (minLon > maxLon), eastern longitudes
 * are unwrapped (maxLon + 360) so the path is one continuous loop — same
 * convention as healpix-ts corner longitudes.
 */
export function bboxToPath(bbox: BBox): [number, number][] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const eastLon = minLon > maxLon ? maxLon + 360 : maxLon;
  return [
    [minLon, minLat],
    [eastLon, minLat],
    [eastLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat]
  ];
}
