import { useMemo, type RefObject } from 'react';
import { PathLayer, TextLayer } from '@deck.gl/layers';
import {
  HEALPIX_COLOR_MODE_SCALAR,
  HealpixCellsLayer
} from '@developmentseed/deck.gl-healpix';
import { cellsToBoundingBox } from 'healpix-ts';
import type { MapRef } from 'react-map-gl/maplibre';

import { bboxToPath } from './bbox';
import { coloredCellIds, type ColoredCell } from './colored-cells';
import { hexToRgb, PAINT_COLOR_MAP, PAINT_COLORS } from './colors';
import { cellCorners, cellToLonLat } from './healpix-geo';
import { filterCellsWithVisibleLabels, LABEL_FONT_SIZE } from './label-fit';
import type { HealpixScheme, PaintViewState } from './types';

type UsePaintLayersOptions = {
  cells: ColoredCell[];
  nside: number;
  scheme: HealpixScheme;
  showBbox: boolean;
  showCellIds: boolean;
  mapRef: RefObject<MapRef | null>;
  isMapLoaded: boolean;
  viewState: PaintViewState;
};

export function usePaintLayers(opts: UsePaintLayersOptions) {
  const {
    cells,
    nside,
    scheme,
    showBbox,
    showCellIds,
    mapRef,
    isMapLoaded,
    viewState
  } = opts;

  const map = isMapLoaded ? mapRef.current?.getMap() : undefined;
  const cellIds = coloredCellIds(cells);

  const labeledCells = useMemo(() => {
    if (!showCellIds) return [];
    return filterCellsWithVisibleLabels(
      map,
      cellIds,
      nside,
      scheme,
      viewState.zoom,
      viewState.latitude
    );
  }, [
    showCellIds,
    map,
    cellIds,
    nside,
    scheme,
    viewState.zoom,
    viewState.latitude
  ]);

  const labeledCellSet = useMemo(() => new Set(labeledCells), [labeledCells]);

  return useMemo(() => {
    const layers = [];

    if (cells.length > 0) {
      const ids = new Uint32Array(cells.length);
      const values = new Float32Array(cells.length);
      for (let i = 0; i < cells.length; i++) {
        ids[i] = cells[i].id;
        values[i] = cells[i].colorIndex;
      }

      layers.push(
        new HealpixCellsLayer({
          id: `healpix-cells-${nside}-${scheme}`,
          nside,
          scheme,
          cellIds: ids,
          values,
          dimensions: 1,
          colorMode: HEALPIX_COLOR_MODE_SCALAR,
          // The color map will have the colors for the first 5 color indices,
          // so we need to rescale to 0-255.
          colorMap: PAINT_COLOR_MAP,
          rescaleMin: 0,
          rescaleMax: 255
        }),
        new PathLayer<ColoredCell>({
          id: `cell-outlines-${nside}-${scheme}`,
          data: cells,
          getPath: (cell) => {
            const poly = cellCorners(nside, cell.id, scheme);
            return [...poly, poly[0]];
          },
          getColor: (cell) => {
            const [r, g, b] = hexToRgb(PAINT_COLORS[cell.colorIndex]);
            return [r * 255, g * 255, b * 255, 220];
          },
          getWidth: 1,
          widthMinPixels: 1,
          updateTriggers: {
            getPath: [nside, scheme],
            getColor: cells
          }
        })
      );

      const labelsData = cells.filter((c) => labeledCellSet.has(c.id));
      if (showCellIds && labelsData.length > 0) {
        layers.push(
          new TextLayer<ColoredCell>({
            id: `cell-labels-${nside}-${scheme}`,
            data: labelsData,
            getPosition: (cell) => cellToLonLat(nside, cell.id, scheme),
            getText: (cell) => cell.id.toString(),
            getColor: [255, 255, 255],
            getSize: LABEL_FONT_SIZE,
            getTextAnchor: 'middle',
            getAlignmentBaseline: 'center',
            fontSettings: { sdf: true },
            updateTriggers: {
              getPosition: [nside, scheme]
            }
          })
        );
      }
    }

    if (showBbox && cells.length > 0) {
      try {
        const bbox = cellsToBoundingBox(nside, cellIds, scheme);
        layers.push(
          new PathLayer({
            id: `cells-bbox-${nside}-${scheme}`,
            data: [{ path: bboxToPath(bbox) }],
            getPath: (d: { path: [number, number][] }) => d.path,
            getColor: [0, 180, 255, 255],
            getWidth: 2,
            widthMinPixels: 2
          })
        );
      } catch {
        // guarded by cells.length > 0
      }
    }

    return layers;
  }, [cells, cellIds, nside, scheme, showBbox, showCellIds, labeledCellSet]);
}
