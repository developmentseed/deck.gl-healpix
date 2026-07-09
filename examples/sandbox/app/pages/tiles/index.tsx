import { useCallback, useMemo, useState } from 'react';
import Map from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Box,
  Checkbox,
  Code,
  Field,
  Flex,
  NativeSelect,
  Separator,
  Text
} from '@chakra-ui/react';
import { rgb } from 'd3';
import {
  HEALPIX_COLOR_MODE_SCALAR,
  makeColorMap
} from '@developmentseed/deck.gl-healpix';
import {
  HealpixTileLayer,
  type HealpixTileIndex,
  type HealpixTileLayerStats
} from '@developmentseed/deck.gl-healpix-tile';

import {
  ColorSchemeSelect,
  schemeFns,
  type ColorSchemeName
} from '$shared/components/color-scheme';
import { ControlPanel } from '$shared/components/control-panel';
import { DeckGlOverlay } from '$shared/components/deckgl-overlay';

import {
  buildSyntheticTileData,
  TILE_NSIDES,
  TILE_PARENT_LEVELS,
  TILE_ZOOM_OFFSET,
  tileLoadDelay
} from './synthetic-tile-data';

/** Passes fixed pyramid settings into HealpixTileset2D. */
class SyntheticTileLayer extends HealpixTileLayer {
  override _getTilesetOptions() {
    return {
      ...super._getTilesetOptions(),
      availableNsides: TILE_NSIDES,
      parentLevels: TILE_PARENT_LEVELS,
      nsideOffset: TILE_ZOOM_OFFSET
    };
  }
}

export default function PageTiles() {
  const [viewState, setViewState] = useState({
    longitude: -9.75081,
    latitude: 39.27385,
    zoom: 8.5
  });
  const [projection, setProjection] = useState<'globe' | 'mercator'>(
    'mercator'
  );
  const [colorScheme, setColorScheme] =
    useState<ColorSchemeName>('interpolateViridis');
  const [debugTiles, setDebugTiles] = useState(true);
  const [layerStats, setLayerStats] = useState<HealpixTileLayerStats>({
    nside: 0,
    nsideParent: 0,
    tilesRendered: 0,
    cellsRendered: 0
  });

  const colorMap = useMemo(
    () =>
      makeColorMap((t) => {
        const c = rgb(schemeFns[colorScheme](t));
        return [c.r, c.g, c.b, 255];
      }),
    [colorScheme]
  );

  const getTileData = useCallback(
    async ({
      index,
      signal
    }: {
      index: HealpixTileIndex;
      signal?: AbortSignal;
    }) => {
      await tileLoadDelay();
      if (signal?.aborted) return null;
      return buildSyntheticTileData(index);
    },
    []
  );

  const layer = useMemo(() => {
    return new SyntheticTileLayer({
      id: 'healpix-tiles',
      getTileData,
      onStats: setLayerStats,
      debugTiles,
      opacity: 0.3,
      colorMode: HEALPIX_COLOR_MODE_SCALAR,
      colorMap,
      rescaleMin: 0,
      rescaleMax: 1
    });
  }, [getTileData, debugTiles, colorMap]);

  return (
    <Flex w='100%' h='100%' flexFlow='column' position='relative'>
      <ControlPanel
        title='HealpixTileLayer'
        description='Each viewport tile calls getTileData with a HealpixTileIndex. This demo pregenerates a scalar field for every cell at the finest nside on load, then averages it up into the rest of the pyramid.'
      >
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

        <ColorSchemeSelect
          scheme={colorScheme}
          onSchemeChange={setColorScheme}
        />

        <Checkbox.Root
          checked={debugTiles}
          onCheckedChange={(e) => setDebugTiles(!!e.checked)}
          size='sm'
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label fontSize='sm'>
            Show tile ids and borders
            <br />
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
      </ControlPanel>

      <Box flex='1' position='relative' minH={0}>
        <Map
          {...viewState}
          projection={projection}
          onMove={(event) => setViewState(event.viewState)}
          mapStyle={`https://api.maptiler.com/maps/aquarelle-v4/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`}
          style={{ width: '100%', height: '100%' }}
          minZoom={2}
        >
          <DeckGlOverlay layers={[layer]} />
        </Map>
      </Box>
    </Flex>
  );
}
