import { useCallback, useMemo, useRef, useState } from 'react';
import Map, { type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, Flex } from '@chakra-ui/react';

import { DeckGlOverlay } from '$shared/components/deckgl-overlay.tsx';

import type { CellLine } from './colored-cells';
import {
  linesToMapCells,
  removeLinesByCellIds,
  upsertPaintedLines
} from './colored-cells';
import {
  DEFAULT_COLOR_INDEX,
  PAINT_COLORS,
  type PaintColorIndex
} from './colors';
import { DEFAULT_VIEW_STATE } from './constants';
import { fitMapToColoredCells } from './fit-bounds';
import { PaintControls } from './paint-controls';
import type { HealpixScheme, MapTool, PaintViewState } from './types';
import { useCoarsePointer } from './use-coarse-pointer';
import { useMapTool } from './use-map-tool';
import { useNsideRemap } from './use-nside-remap';
import { usePaintLayers } from './use-paint-layers';

export default function PagePaint() {
  const [viewState, setViewState] =
    useState<PaintViewState>(DEFAULT_VIEW_STATE);
  const [nside, setNside] = useState(32);
  const [scheme, setScheme] = useState<HealpixScheme>('nest');
  const [lines, setLines] = useState<CellLine[]>([]);
  const [selectedColorIndex, setSelectedColorIndex] =
    useState<PaintColorIndex>(DEFAULT_COLOR_INDEX);
  const [activeTool, setActiveTool] = useState<MapTool | null>(null);
  const [showBbox, setShowBbox] = useState(false);
  const [showCellIds, setShowCellIds] = useState(true);

  const mapRef = useRef<MapRef>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const isCoarsePointer = useCoarsePointer();

  const mapCells = useMemo(() => linesToMapCells(lines), [lines]);

  useNsideRemap({ nside, scheme, setLines });

  const paintCells = useCallback(
    (ids: number[]) => {
      if (ids.length === 0) return;
      setLines((prev) => upsertPaintedLines(prev, ids, selectedColorIndex));
    },
    [selectedColorIndex]
  );

  const eraseCells = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    setLines((prev) => removeLinesByCellIds(prev, ids));
  }, []);

  const { dragPanEnabled, mapTouchAction } = useMapTool({
    mapRef,
    isMapLoaded,
    activeTool,
    paintColorHex: PAINT_COLORS[selectedColorIndex],
    isCoarsePointer,
    nside,
    scheme,
    onPaintCells: paintCells,
    onEraseCells: eraseCells
  });

  const layers = usePaintLayers({
    cells: mapCells,
    nside,
    scheme,
    showBbox,
    showCellIds,
    mapRef,
    isMapLoaded,
    viewState
  });

  const fitBounds = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || mapCells.length === 0) return;
    fitMapToColoredCells(map, nside, scheme, mapCells);
  }, [mapCells, nside, scheme]);

  return (
    <Flex
      w='100%'
      h='100%'
      direction='column'
      position='relative'
      overflow='hidden'
      overscrollBehavior='none'
    >
      <PaintControls
        nside={nside}
        scheme={scheme}
        lines={lines}
        selectedColorIndex={selectedColorIndex}
        activeTool={activeTool}
        isCoarsePointer={isCoarsePointer}
        showBbox={showBbox}
        showCellIds={showCellIds}
        canFitBounds={mapCells.length > 0 && isMapLoaded}
        onNsideChange={setNside}
        onSchemeChange={setScheme}
        onLinesChange={setLines}
        onColorIndexChange={setSelectedColorIndex}
        onToolChange={setActiveTool}
        onClearCells={() => setLines([])}
        onFitBounds={fitBounds}
        onShowBboxChange={setShowBbox}
        onShowCellIdsChange={setShowCellIds}
      />

      <Box
        flex='1'
        position='relative'
        overflow='hidden'
        overscrollBehavior='none'
        touchAction={mapTouchAction}
      >
        <Map
          {...viewState}
          ref={mapRef}
          onLoad={() => setIsMapLoaded(true)}
          onMove={(event) => {
            const vs = event.viewState;
            setViewState({
              latitude: vs.latitude,
              longitude: vs.longitude,
              zoom: vs.zoom
            });
          }}
          mapStyle={`https://api.maptiler.com/maps/dataviz-v4-light/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`}
          style={{ width: '100%', height: '100%' }}
          dragPan={dragPanEnabled}
          dragRotate={false}
          touchPitch={false}
          pitchWithRotate={false}
          doubleClickZoom={false}
          maxPitch={0}
          minPitch={0}
        >
          <DeckGlOverlay layers={layers} />
        </Map>
      </Box>
    </Flex>
  );
}
