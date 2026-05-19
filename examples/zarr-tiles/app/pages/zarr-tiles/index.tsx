import { useCallback, useMemo, useRef, useState } from 'react';
import Map, { MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Box,
  Checkbox,
  Code,
  Field,
  Flex,
  NativeSelect,
  Separator,
  Slider,
  Text
} from '@chakra-ui/react';
import { rgb } from 'd3';
import {
  HEALPIX_COLOR_MODE_RGB,
  HEALPIX_COLOR_MODE_SCALAR,
  makeColorMap
} from '@developmentseed/deck.gl-healpix';
import {
  HealpixZarrTileLayer,
  type HealpixZarrLayerStats
} from '@developmentseed/deck.gl-healpix-zarr';

import {
  ColorSchemeSelect,
  schemeFns,
  type ColorSchemeName
} from '$shared/components/color-scheme';
import { DeckGlOverlay } from '$shared/components/deckgl-overlay';

import { COMPOSITES, type CompositeKey } from './sentinel-zarr-bands';
import { NDVI_MODULE, RGB_COMPOSITE_MODULE } from './bands-modules';
import { useParentOutline } from './parent-outline-hook';

const base =
  import.meta.env.VITE_STATIC_FILES_URL || 'https://healpix-data.ds.io';
const ZARR_URL = `${base}/lisbon-multiscale.zarr`;

const VIS_OPTIONS = Object.entries(COMPOSITES).map(([k, v]) => ({
  value: k as CompositeKey,
  label: v.label
}));

export default function PageZarrTiles() {
  const mapRef = useRef<MapRef>(null);
  const [viewState, setViewState] = useState({
    longitude: -9.75081,
    latitude: 39.27385,
    zoom: 8.5
  });
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [projection, setProjection] = useState<'globe' | 'mercator'>(
    'mercator'
  );

  const [visMode, setVisMode] = useState<CompositeKey>('true_color');
  const [selectedBands, setSelectedBands] = useState<string[] | null>(
    COMPOSITES.true_color.bands as string[]
  );
  const [rescaleMin, setRescaleMin] = useState(0.0);
  const [rescaleMax, setRescaleMax] = useState(0.6);
  const [colorScheme, setColorScheme] =
    useState<ColorSchemeName>('interpolateViridis');
  const [debugTiles, setDebugTiles] = useState(false);
  const [layerStats, setLayerStats] = useState<HealpixZarrLayerStats>({
    nside: 0,
    nsideParent: 0,
    tilesRendered: 0,
    cellsRendered: 0
  });

  const isNdvi = visMode === 'ndvi';

  const handleVisModeChange = useCallback((mode: CompositeKey) => {
    setVisMode(mode);
    setSelectedBands(COMPOSITES[mode].bands as string[]);
    if (mode === 'ndvi') {
      setRescaleMin(0.0);
      setRescaleMax(0.6);
    }
  }, []);

  const colorMap = useMemo(
    () =>
      makeColorMap((t) => {
        const c = rgb(schemeFns[colorScheme](t));
        return [c.r, c.g, c.b, 255];
      }),
    [colorScheme]
  );

  const shaderModules = useMemo(
    () => (isNdvi ? [NDVI_MODULE] : [RGB_COMPOSITE_MODULE]),
    [isNdvi]
  );

  const layer = useMemo(
    () =>
      new HealpixZarrTileLayer({
        id: 'sentinel-zarr',
        url: ZARR_URL,
        bands: selectedBands,
        zoomOffset: 5,
        colorMode: isNdvi ? HEALPIX_COLOR_MODE_SCALAR : HEALPIX_COLOR_MODE_RGB,
        shaderModules,
        onStats: setLayerStats,
        debugTiles,
        ...(isNdvi && { colorMap, rescaleMin, rescaleMax })
      }),
    [
      selectedBands,
      isNdvi,
      shaderModules,
      colorMap,
      rescaleMin,
      rescaleMax,
      debugTiles
    ]
  );

  const {
    layers: parentOutlineLayers,
    showParentOutline,
    setParentOutlineVisibility
  } = useParentOutline({
    mapRef,
    isMapLoaded,
    nside: layerStats.nsideParent
  });

  return (
    <Flex w='100%' h='100%' flexFlow='column' position='relative'>
      <Flex
        position='absolute'
        top={4}
        left={4}
        zIndex={1000}
        bg='white'
        borderRadius='md'
        boxShadow='md'
        p={4}
        minW='220px'
        flexFlow='column'
        gap={4}
        w='30rem'
        maxH='90vh'
        overflowY='auto'
      >
        <Text fontStyle='italic'>
          Sentinel-2 HEALPix pyramid
          <br />
          <Text as='span' fontSize='sm'>
            Tiles are loaded on demand from a multiscales Zarr store.
          </Text>
        </Text>

        <Field.Root>
          <Field.Label fontSize='sm' fontWeight='semibold' mb={1}>
            Projection
          </Field.Label>
          <NativeSelect.Root size='sm'>
            <NativeSelect.Field
              value={projection}
              onChange={(e) =>
                setProjection(e.currentTarget.value as 'globe' | 'mercator')
              }
            >
              <option value='globe'>Globe</option>
              <option value='mercator'>Mercator</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field.Root>

        <Field.Root>
          <Field.Label fontSize='sm' fontWeight='semibold' mb={1}>
            Visualization
          </Field.Label>
          <NativeSelect.Root size='sm'>
            <NativeSelect.Field
              value={visMode}
              onChange={(e) =>
                handleVisModeChange(e.currentTarget.value as CompositeKey)
              }
            >
              {VIS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field.Root>

        {isNdvi && (
          <>
            <Field.Root>
              <Field.Label fontSize='sm' fontWeight='semibold' mb={1}>
                NDVI rescale
              </Field.Label>
              <Slider.Root
                width='100%'
                min={-1}
                max={1}
                step={0.005}
                value={[rescaleMin, rescaleMax]}
                onValueChange={({ value }) => {
                  const [a, b] = value;
                  setRescaleMin(Math.min(a, b));
                  setRescaleMax(Math.max(a, b));
                }}
              >
                <Slider.Control>
                  <Slider.Track>
                    <Slider.Range />
                  </Slider.Track>
                  <Slider.Thumbs />
                </Slider.Control>
              </Slider.Root>
              <Flex justify='space-between' mt={1} fontSize='sm' gap={4}>
                <Text>Min: {rescaleMin.toFixed(3)}</Text>
                <Text>Max: {rescaleMax.toFixed(3)}</Text>
              </Flex>
            </Field.Root>

            <ColorSchemeSelect
              scheme={colorScheme}
              onSchemeChange={setColorScheme}
            />
          </>
        )}

        <Checkbox.Root
          checked={showParentOutline}
          onCheckedChange={(e) => setParentOutlineVisibility(!!e.checked)}
          size='sm'
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label fontSize='sm'>
            Show viewport tile outlines
          </Checkbox.Label>
        </Checkbox.Root>

        <Checkbox.Root
          checked={debugTiles}
          onCheckedChange={(e) => setDebugTiles(!!e.checked)}
          size='sm'
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label fontSize='sm'>
            Show tile ids and borders <br />
            <Text as='span' fontSize='xs'>
              Format: <Code>data_order-parent_order-parent_index</Code>
            </Text>
          </Checkbox.Label>
        </Checkbox.Root>

        <Separator />

        <Flex flexFlow='column' gap={1} fontSize='sm'>
          <Text fontWeight='semibold' mb={1}>
            Stats
          </Text>
          <Flex justify='space-between'>
            <Text color='fg.muted'>Zoom</Text>
            <Text fontFamily='mono'>{viewState.zoom.toFixed(2)}</Text>
          </Flex>
          <Flex justify='space-between'>
            <Text color='fg.muted'>Data nside</Text>
            <Text fontFamily='mono'>
              {layerStats.nside > 0 ? layerStats.nside : '—'}
            </Text>
          </Flex>
          <Flex justify='space-between'>
            <Text color='fg.muted'>Parent nside</Text>
            <Text fontFamily='mono'>
              {layerStats.nsideParent > 0 ? layerStats.nsideParent : '—'}
            </Text>
          </Flex>
          <Flex justify='space-between'>
            <Text color='fg.muted'>Tiles rendered</Text>
            <Text fontFamily='mono'>{layerStats.tilesRendered}</Text>
          </Flex>
          <Flex justify='space-between'>
            <Text color='fg.muted'>Cells rendered</Text>
            <Text fontFamily='mono'>
              {layerStats.cellsRendered.toLocaleString()}
            </Text>
          </Flex>
        </Flex>
      </Flex>

      <Box flex='1' position='relative' minH={0}>
        <Map
          {...viewState}
          projection={projection}
          ref={mapRef}
          onLoad={() => setIsMapLoaded(true)}
          onMove={(event) => setViewState(event.viewState)}
          mapStyle={`https://api.maptiler.com/maps/aquarelle-v4/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`}
          style={{ width: '100%', height: '100%' }}
        >
          <DeckGlOverlay layers={[...parentOutlineLayers, layer]} />
        </Map>
      </Box>
    </Flex>
  );
}
