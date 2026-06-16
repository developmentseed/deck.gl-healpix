import { RefObject, useEffect, useMemo, useState } from 'react';
import { PathLayer, TextLayer } from '@deck.gl/layers';
import {
  cornersNestLonLat,
  pix2LonLatNest,
  queryBoxInclusiveNest
} from 'healpix-ts';
import { MapRef } from 'react-map-gl/maplibre';

interface UseParentOutlineProps {
  mapRef: RefObject<MapRef | null>;
  isMapLoaded: boolean;
  nside: number;
}

export function useParentOutline(opts: UseParentOutlineProps) {
  const { mapRef, isMapLoaded, nside } = opts;

  const [showParentOutline, setShowParentOutline] = useState(true);
  const [viewportCells, setViewportCells] = useState<number[]>([]);

  // Keep parent-outline cells in sync with the layer's current nsideParent
  useEffect(() => {
    if (!showParentOutline || !isMapLoaded || !nside) return;

    const onMove = () => {
      const b = mapRef.current?.getBounds();
      if (!b) return;
      const bounds: [number, number, number, number] = [
        b.getWest(),
        b.getSouth(),
        b.getEast(),
        b.getNorth()
      ];
      setViewportCells(queryBoxInclusiveNest(nside, bounds));
    };

    onMove();
    mapRef.current?.on('moveend', onMove);
    return () => {
      mapRef.current?.off('moveend', onMove);
    };
  }, [showParentOutline, isMapLoaded, nside]);

  // Clear cells when outline is toggled off
  useEffect(() => {
    if (!showParentOutline) setViewportCells([]);
  }, [showParentOutline]);

  const layers = useViewPortCellsLayer(nside, viewportCells);

  return {
    layers,
    showParentOutline,
    setParentOutlineVisibility: setShowParentOutline
  };
}

export function useViewPortCellsLayer(nside: number, cells: number[]) {
  return useMemo(() => {
    if (cells.length === 0 || nside === 0) return [];
    return [
      new PathLayer({
        id: 'cell-outlines',
        data: cells,
        getPath: (cell) => {
          const poly = cornersNestLonLat(nside, cell);
          return [...poly, poly[0]];
        },
        getColor: [255, 255, 255],
        getWidth: 1,
        widthMinPixels: 2
      }),
      new TextLayer({
        id: 'cell-labels',
        data: cells,
        getPosition: (cell) => {
          return pix2LonLatNest(nside, cell);
        },
        getText: (cell) => cell.toString(),
        getColor: [255, 255, 255],
        getSize: 16,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center'
      })
    ];
  }, [nside, cells]);
}
