# Design: Per-Band Zarr Groups in `HealpixZarrTileLayer`

**Date:** 2026-05-13  
**Package:** `packages/deck.gl-healpix-zarr`  
**Status:** Approved  
**Zarr store spec:** `docs/specs/healpix-pyramid-zarr.md`

---

## Background

The pyramid Zarr store previously stored all bands in a single 2D `values[npix, nbands]` array per nside level. The updated store format (see the store spec) stores each band as a separate 1D array under `nside_*/bands/<band>`. This design adapts the layer to that format and adds:

- A `bands` controlled prop so the caller decides which variables to render.
- An `onMetadata` callback so the caller is informed of available bands and can present a picker UI before the first tile loads.
- Support for stores with any number of bands, including a single variable.

---

## Architecture

```
URL → getRoot (cached) → loadRootMetadata (cached) → onMetadata fires
                         ↓
              getGroupHandle(url, nside)
               opens all band array handles (cached per (url, nside))
                         ↓
              loadTileFromGroup(group, parentCell, props.bands, ...)
               fetches only selected band slices in parallel
               interleaves into Float32Array
                         ↓
              HealpixCellsLayer(values, dimensions=bands.length)
```

---

## Changes

### 1. New exported type: `ZarrPyramidMetadata`

```ts
export interface ZarrPyramidMetadata {
  bands: string[];      // ordered list from root attrs.bands
  nsides: number[];     // available resolution levels, ascending
  baseNside: number;
  minNside: number;
  parentLevels: number; // from root attrs.parent_levels
}
```

### 2. `GroupHandle` (in `healpix-zarr-tile-layer.ts`)

Remove `valueArr` and `numValueBands`. Add a map of per-band array handles.

```ts
export interface GroupHandle {
  nside: number;
  nsideParent: number;
  cellIdArr: zarr.Array<zarr.DataType, CachedZarrStore>;
  parentOffsetsArr: zarr.Array<zarr.DataType, CachedZarrStore>;
  bandArrs: Map<string, zarr.Array<zarr.DataType, CachedZarrStore>>;
  allBands: string[];   // ordered as in root attrs.bands
}
```

`getGroupHandle` opens a handle for every band in `root.attrs.bands` in parallel via `Promise.all`. Cache key remains `(url, nside)`.

### 3. Root metadata loader

Replaces `loadAvailableNsides`. Reads root `zarr.json` once and derives both nsides and bands. Cached per URL via `rootMetadataCache` (replaces `nsideCache`). Returns the same `ZarrPyramidMetadata` type that is passed to `onMetadata` — one type, not two.

```ts
export async function loadRootMetadata(url: string): Promise<ZarrPyramidMetadata>
```

### 4. `loadTileFromGroup`

New signature adds `selectedBands`:

```ts
export async function loadTileFromGroup(
  group: GroupHandle,
  parentCell: number,
  selectedBands: string[],
  get: ZarrGetter,
  signal?: AbortSignal
): Promise<HealpixZarrTileData | null>
```

Steps:
1. Return `null` immediately if `selectedBands` is empty.
2. Read `parent_offsets[parentCell : parentCell+2]` → `rowRange` (unchanged).
3. Fetch `cell_id[rowStart:rowEnd]` and each `selectedBands[i][rowStart:rowEnd]` in parallel via `Promise.all`.
4. Interleave into a row-major `Float32Array` of length `npix × selectedBands.length`:
   `[b0_p0, b1_p0, …, bN_p0, b0_p1, …]`
5. Return `{ nside, cellIds, values: interleaved, bands: selectedBands }`.

Returns `null` if the tile is empty or the signal is aborted at any checkpoint.

### 5. `HealpixZarrTileLayerProps`

Remove `dimensions` and `getBands`. Add `bands` and `onMetadata`:

```ts
type _HealpixZarrTileLayerProps = {
  /** URL of the Zarr v3 store conforming to docs/specs/healpix-pyramid-zarr.md */
  url: string;
  /** Shift applied to viewport zoom when selecting nside. @default 5 */
  zoomOffset: number;
  /**
   * Value mapped to colorMap index 0. @default 0
   * @deprecated Use `rescaleMin` instead.
   */
  min: number;
  /**
   * Value mapped to colorMap index 255. @default 1
   * @deprecated Use `rescaleMax` instead.
   */
  max: number;
  /** Cells with value below this are discarded (not rendered). Default: unbounded. */
  filterMin?: number;
  /** Cells with value above this are discarded (not rendered). Default: unbounded. */
  filterMax?: number;
  /**
   * Value mapped to colorMap index 0 for scalar color modes.
   * Defaults to `min` for backwards compatibility, then `0`.
   */
  rescaleMin?: number;
  /**
   * Value mapped to colorMap index 255 for scalar color modes.
   * Defaults to `max` for backwards compatibility, then `1`.
   */
  rescaleMax?: number;
  /**
   * Bands to load and render. null = wait (render nothing).
   * Order determines column order in the interleaved values array.
   */
  bands: string[] | null;
  /**
   * Called once when root metadata becomes available (and again if url changes).
   * Use this to populate a band-picker UI. The root zarr.Group is provided for
   * any custom attribute reads beyond what ZarrPyramidMetadata exposes.
   */
  onMetadata?: (meta: ZarrPyramidMetadata, root: zarr.Group<CachedZarrStore>) => void;
};
```

Default for `bands`: `null`.  
Default for `onMetadata`: `undefined`.  
Default for `filterMin`/`filterMax`: `undefined` (no cells discarded).  
Default for `rescaleMin`/`rescaleMax`: `undefined` (falls back to `min`/`max`).

### 6. Layer state

```ts
declare state: TileLayer['state'] & {
  availableNsides: number[];
  parentLevels: number;
};
```

`selectedBands` is no longer in state — `this.props.bands` is the single source of truth.
`parentLevels` comes from `root.attrs.parent_levels` via `loadRootMetadata`; it is not a layer prop.

### 7. `_loadMetadata()`

```ts
private async _loadMetadata(): Promise<void> {
  const { url, onMetadata } = this.props;
  if (!url) return;
  try {
    const root = await getRoot(url);
    const meta = await loadRootMetadata(url);
    this.setState({ availableNsides: meta.nsides });
    onMetadata?.(meta, root);
    (this as CompositeLayer).setNeedsUpdate();
  } catch (_) {
    // layer stays empty until URL is valid
  }
}
```

Re-runs when `url` prop changes (handled in `updateState` by comparing `prevProps.url`).

### 8. `getTileData()`

```ts
override getTileData(tile: { index: unknown; signal?: AbortSignal }) {
  const { url, bands } = this.props;
  if (!bands || bands.length === 0) return Promise.resolve(null);
  const { x: parentCell, z } = tile.index as HealpixTileIndex;
  const nside = Math.pow(2, z);
  return getGroupHandle(url, nside).then((group) =>
    loadTileFromGroup(group, parentCell, bands, zarr.get as ZarrGetter, tile.signal)
  );
}
```

### 9. `renderSubLayers()`

`dimensions` auto-derived from tile data:

```ts
override renderSubLayers(
  props: TileLayerProps<HealpixZarrTileData | null> & { data: HealpixZarrTileData | null }
) {
  const { data } = props;
  if (!data || data.cellIds.length === 0) return null;
  return new HealpixCellsLayer({
    ...this.getSubLayerProps({ id: `tile-${(props as any).tile?.id ?? ''}` }),
    nside: data.nside,
    cellIds: data.cellIds,
    values: data.values,
    dimensions: data.bands.length,
    min: this.props.min,
    max: this.props.max,
    rescaleMin: this.props.rescaleMin,
    rescaleMax: this.props.rescaleMax,
    filterMin: this.props.filterMin,
    filterMax: this.props.filterMax,
  });
}
```

---

## `types.ts`

No structural changes. `HealpixZarrTileData` already has `bands: string[]` and `values: Float32Array`.

---

## `index.ts` exports

Replace `loadAvailableNsides` with:
- `loadRootMetadata`
- `ZarrPyramidMetadata` (type)

---

## Tests (`healpix-zarr-tile-layer.test.ts`)

Update `GroupHandle` stubs:
- Replace `valueArr` + `numValueBands` with `bandArrs: Map<string, stub>` and `allBands`.
- `loadTileFromGroup` calls pass a `selectedBands` argument.

New test cases:
- Empty `selectedBands` → returns `null`.
- Correct interleave order: 2 bands × 3 pixels produces `[b0_p0, b1_p0, b0_p1, b1_p1, b0_p2, b1_p2]`.
- Aborted signal at each async checkpoint returns `null`.

---

## Usage examples

### Load all bands (fire and forget)

```ts
const [availableBands, setAvailableBands] = useState<string[]>([]);
const [selectedBands, setSelectedBands] = useState<string[] | null>(null);

new HealpixZarrTileLayer({
  id: 'sentinel2',
  url: '/data/pyramid.zarr',
  bands: selectedBands,
  onMetadata: (meta) => {
    setAvailableBands(meta.bands);
    setSelectedBands(meta.bands); // load everything immediately
  },
  rescaleMin: 0,
  rescaleMax: 0.3,
})
```

### User-controlled band picker

```ts
// selectedBands starts null — layer renders nothing until user picks
new HealpixZarrTileLayer({
  id: 'sentinel2',
  url: '/data/pyramid.zarr',
  bands: selectedBands,          // controlled by app state
  onMetadata: (meta) => {
    setAvailableBands(meta.bands); // populate a <select> in the UI
  },
  rescaleMin: 0,
  rescaleMax: 0.3,
})
```

### Single-value store

```ts
// meta.bands will be ["elevation"] (or whatever the store names it)
new HealpixZarrTileLayer({
  id: 'elevation',
  url: '/data/elevation.zarr',
  bands: ['elevation'],
  rescaleMin: 0,
  rescaleMax: 4000,
  filterMin: 0,   // discard sea-level cells
})
```

---

## Files changed

| File | Change |
|------|--------|
| `src/healpix-zarr-tile-layer.ts` | `GroupHandle`, `loadRootMetadata` (replaces `loadAvailableNsides`), `loadTileFromGroup`, layer props/state, `_loadMetadata`, `getTileData`, `renderSubLayers` |
| `src/healpix-zarr-tile-layer.test.ts` | Update stubs; add interleave, empty-bands, and abort tests |
| `src/types.ts` | No change |
| `src/utils.ts` | No change |
| `src/index.ts` | Replace `loadAvailableNsides` export with `loadRootMetadata`; export `ZarrPyramidMetadata` |
| `docs/specs/healpix-pyramid-zarr.md` | New — store format specification |
