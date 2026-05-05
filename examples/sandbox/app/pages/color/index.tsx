import { useEffect, useMemo, useState } from 'react';
import Map from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, Field, Flex, NativeSelect, Slider, Text } from '@chakra-ui/react';
import {
  HEALPIX_COLOR_MODE_RGB,
  HEALPIX_COLOR_MODE_SCALAR,
  HealpixCellsLayer,
  makeColorMap
} from '@developmentseed/deck.gl-healpix';
import { rgb } from 'd3';

import {
  ColorSchemeSelect,
  schemeFns,
  type ColorSchemeName
} from '$shared/components/color-scheme';
import { DeckGlOverlay } from '$shared/components/deckgl-overlay';

import {
  COMPOSITE_COLS,
  RGB_NUM,
  type SentinelHealpixZarr,
  loadSentinelHealpixZarr
} from './sentinel-zarr';
import { BAND_CHOICES, BAND_INDEX, BandLabel } from './sentinel-zarr-bands';

const ZARR_URL = `${import.meta.env.VITE_BASE_URL}/sentinel-healpix.zarr`;

export type BandVisualizationMode =
  | 'true_color'
  | 'infrared_false_color'
  | 'ndvi'
  | 'swir'
  | BandLabel;

const COMPOSITE_OPTIONS: { value: BandVisualizationMode; label: string }[] = [
  { value: 'true_color', label: 'True color' },
  { value: 'infrared_false_color', label: 'Infrared false color' },
  { value: 'swir', label: 'SWIR composite' },
  { value: 'ndvi', label: 'NDVI' }
];

export const VISUALIZATION_OPTIONS: {
  value: BandVisualizationMode;
  label: string;
}[] = [...COMPOSITE_OPTIONS, ...BAND_CHOICES];

function isNdviMode(v: BandVisualizationMode): boolean {
  return v === 'ndvi';
}

function isSingleBandMode(v: BandVisualizationMode): v is BandLabel {
  return v in BAND_INDEX;
}

function defaultDisplayRange(mode: BandVisualizationMode): [number, number] {
  if (mode === 'ndvi') return [0.0, 0.6];
  if (isSingleBandMode(mode)) return [0, 0.25];
  return [0, 0.3];
}

export default function PageColor() {
  const [viewState, setViewState] = useState({
    longitude: -9.75081,
    latitude: 39.27385,
    zoom: 8.5
  });

  const [projection, setProjection] = useState<'globe' | 'mercator'>(
    'mercator'
  );

  const [zarrData, setZarrData] = useState<SentinelHealpixZarr | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadPending, setLoadPending] = useState(true);

  const [visualization, setVisualization] =
    useState<BandVisualizationMode>('true_color');
  const [rescaleMin, setRescaleMin] = useState(0);
  const [rescaleMax, setRescaleMax] = useState(1);
  const [filterMin, setFilterMin] = useState(-Infinity);
  const [filterMax, setFilterMax] = useState(Infinity);
  const [colorScheme, setColorScheme] =
    useState<ColorSchemeName>('interpolateViridis');

  useEffect(() => {
    let cancelled = false;
    setLoadPending(true);
    setLoadError(null);
    void loadSentinelHealpixZarr(ZARR_URL)
      .then((d) => {
        if (!cancelled) {
          setZarrData(d);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setZarrData(null);
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const [lo, hi] = defaultDisplayRange(visualization);
    setRescaleMin(lo);
    setRescaleMax(hi);
    setFilterMin(-Infinity);
    setFilterMax(Infinity);
  }, [visualization]);

  const ndvi = isNdviMode(visualization);
  const singleBand = isSingleBandMode(visualization);
  const showScalarControls = ndvi || singleBand;

  const displayRangeMin = ndvi ? -1 : 0;
  const displayRangeMax = 1;
  const filterSliderMin = Number.isFinite(filterMin)
    ? filterMin
    : displayRangeMin;
  const filterSliderMax = Number.isFinite(filterMax)
    ? filterMax
    : displayRangeMax;

  const colorMap = useMemo(
    () =>
      makeColorMap((t) => {
        const c = rgb(schemeFns[colorScheme](t));
        return [c.r, c.g, c.b, 255];
      }),
    [colorScheme]
  );

  const selectorModule = useSelectorModule(visualization);

  const layers = useMemo(() => {
    if (!zarrData) return [];
    const { nside, cellIds, valuesFlat, nbands } = zarrData;
    const isRgbComposite = !ndvi && !singleBand;

    return [
      new HealpixCellsLayer({
        id: 'healpix-zarr',
        nside,
        scheme: 'nest',
        cellIds,
        values: valuesFlat,
        dimensions: nbands,
        colorMode: isRgbComposite
          ? HEALPIX_COLOR_MODE_RGB
          : HEALPIX_COLOR_MODE_SCALAR,
        rescaleMin,
        rescaleMax,
        filterMin,
        filterMax,
        colorMap,
        shaderModules: [selectorModule]
      })
    ];
  }, [
    zarrData,
    ndvi,
    singleBand,
    selectorModule,
    colorMap,
    rescaleMin,
    rescaleMax,
    filterMin,
    filterMax
  ]);

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
          Sentinel 2 scene with 10 bands in healpix
          <br />
          <Text as='span' fontSize='sm'>
            Cell coloring is computed on the GPU from the selected source values
            and color mode. RGB visualizations render selected values directly,
            while scalar visualizations map through a color scheme after
            optional filtering and rescaling.
          </Text>
        </Text>

        {loadPending && <Text fontSize='sm'>Loading Zarr…</Text>}
        {loadError && (
          <Text color='red.fg' fontSize='sm'>
            {loadError}
          </Text>
        )}

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
              value={visualization}
              onChange={(e) =>
                setVisualization(e.currentTarget.value as BandVisualizationMode)
              }
            >
              {VISUALIZATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field.Root>

        {showScalarControls && (
          <Field.Root>
            <Field.Label fontSize='sm' fontWeight='semibold' mb={1}>
              {ndvi ? 'NDVI rescale' : 'Rescale'}
            </Field.Label>
            <Slider.Root
              width='100%'
              min={displayRangeMin}
              max={displayRangeMax}
              step={0.002}
              value={[rescaleMin, rescaleMax]}
              onValueChange={({ value }) => {
                const [a, b] = value;
                const lo = Math.min(a, b);
                const hi = Math.max(a, b);
                setRescaleMin(lo);
                setRescaleMax(hi);
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
        )}

        {showScalarControls && (
          <Field.Root>
            <Field.Label fontSize='sm' fontWeight='semibold' mb={1}>
              Visibility filter
            </Field.Label>
            <Slider.Root
              width='100%'
              min={displayRangeMin}
              max={displayRangeMax}
              step={0.002}
              value={[filterSliderMin, filterSliderMax]}
              onValueChange={({ value }) => {
                const [a, b] = value;
                const lo = Math.min(a, b);
                const hi = Math.max(a, b);
                setFilterMin(lo);
                setFilterMax(hi);
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
              <Text>
                Min:{' '}
                {Number.isFinite(filterMin) ? filterMin.toFixed(3) : 'none'}
              </Text>
              <Text>
                Max:{' '}
                {Number.isFinite(filterMax) ? filterMax.toFixed(3) : 'none'}
              </Text>
            </Flex>
          </Field.Root>
        )}

        {showScalarControls && (
          <ColorSchemeSelect
            scheme={colorScheme}
            onSchemeChange={setColorScheme}
          />
        )}
      </Flex>

      <Box flex='1' position='relative' minH={0}>
        <Map
          {...viewState}
          projection={projection}
          onMove={(event) => setViewState(event.viewState)}
          mapStyle={`https://api.maptiler.com/maps/aquarelle-v4/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`}
          style={{ width: '100%', height: '100%' }}
        >
          {!loadPending && !loadError && zarrData && (
            <DeckGlOverlay layers={layers} />
          )}
        </Map>
      </Box>
    </Flex>
  );
}

function useSelectorModule(visualization: BandVisualizationMode) {
  // Per-visualization fragment-shader injection.
  //
  // The 10 raw band values are uploaded to the GPU once via `dimensions: NBANDS`
  // (see the layer config below). For each visualization mode we build a small
  // shader module that injects into `fs:HEALPIX_SELECT_VALUES`, picks the
  // relevant channels with `healpixValueAt(...)`, and writes the result into
  // the `selectedValues` inout parameter. The downstream filter / rescale /
  // colorMap stages then consume that vec4.
  //
  // The hook signature is
  //   fs:HEALPIX_SELECT_VALUES(inout vec4 selectedValues, FragmentGeometry geometry)
  // so write to `selectedValues` (the parameter).
  //
  // Alternative — pre-select on the JavaScript side.
  // Writing GLSL is not required: the `extractColumn`, `buildCompositeRgb`,
  // and `buildNdvi` helpers in `./sentinel-zarr.ts` show the equivalent
  // CPU-side approach (build a smaller `Float32Array` per mode with
  // `dimensions: 1` or `3` and upload that). The shader-hook approach is
  // preferred here because it uploads the full multi-band texture once and
  // switches visualization without re-uploading anything to the GPU.
  return useMemo(() => {
    if (isNdviMode(visualization)) {
      return {
        name: 'healpixSelector_ndvi',
        inject: {
          'fs:HEALPIX_SELECT_VALUES': `\
float red = healpixValueAt(${BAND_INDEX.b04});
float nir = healpixValueAt(${BAND_INDEX.b8a});
float denom = max(red + nir, 1e-6);
float ndvi = (nir - red) / denom;
selectedValues = vec4(ndvi, 0.0, 0.0, 0.0);
`
        }
      };
    }

    if (isSingleBandMode(visualization)) {
      const col = BAND_INDEX[visualization];
      return {
        name: `healpixSelector_band_${visualization}`,
        inject: {
          'fs:HEALPIX_SELECT_VALUES': `\
selectedValues = vec4(healpixValueAt(${col}), 0.0, 0.0, 0.0);
`
        }
      };
    }

    const cols = COMPOSITE_COLS[visualization as keyof typeof COMPOSITE_COLS];
    const stretch = (1 / RGB_NUM).toFixed(6);
    return {
      name: `healpixSelector_${visualization}`,
      inject: {
        'fs:HEALPIX_SELECT_VALUES': `\
const float kStretch = ${stretch};
selectedValues = vec4(
  clamp(healpixValueAt(${cols.r}) * kStretch, 0.0, 1.0),
  clamp(healpixValueAt(${cols.g}) * kStretch, 0.0, 1.0),
  clamp(healpixValueAt(${cols.b}) * kStretch, 0.0, 1.0),
  1.0
);
`
      }
    };
  }, [visualization]);
}
