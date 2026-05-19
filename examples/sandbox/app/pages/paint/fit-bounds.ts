import { cellsToBoundingBox } from 'healpix-ts';
import type { Map as MaplibreMap } from 'maplibre-gl';

import { coloredCellIds } from './colored-cells';
import type { ColoredCell } from './colored-cells';
import type { HealpixScheme } from './types';

const FIT_PADDING = 48;

export function fitMapToColoredCells(
  map: MaplibreMap,
  nside: number,
  scheme: HealpixScheme,
  cells: ColoredCell[]
): void {
  const ids = coloredCellIds(cells);
  if (ids.length === 0) return;

  const [minLon, minLat, maxLon, maxLat] = cellsToBoundingBox(
    nside,
    ids,
    scheme
  );
  map.fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat]
    ],
    { padding: FIT_PADDING, duration: 800 }
  );
}
