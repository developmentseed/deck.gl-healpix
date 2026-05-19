import { type DefaultProps, type UpdateParameters } from '@deck.gl/core';
import {
  TileLayer,
  type TileLayerProps,
  type _Tile2DHeader as Tile2DHeader
} from '@deck.gl/geo-layers';
import * as zarr from 'zarrita';
import {
  HEALPIX_COLOR_MODE_RGB,
  HealpixCellsLayer
} from '@developmentseed/deck.gl-healpix';
import type { ShaderModule } from '@luma.gl/shadertools';
import { HealpixTileset2D } from './healpix-tileset-2d';
import {
  getRoot,
  getGroupHandle,
  loadRootMetadata,
  loadTileFromGroup
} from './zarr-pyramid';
import type { ZarrPyramidMetadata } from './zarr-pyramid';
import type { CachedZarrStore } from './cached-zarr-store';
import type { HealpixTileIndex, HealpixZarrTileData } from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Stats
// ──────────────────────────────────────────────────────────────────────────────

export type HealpixZarrLayerStats = {
  nside: number;
  nsideParent: number;
  tilesRendered: number;
  cellsRendered: number;
};

// ──────────────────────────────────────────────────────────────────────────────
// Layer props
// ──────────────────────────────────────────────────────────────────────────────

type _HealpixZarrTileLayerProps = {
  /** URL of the Zarr v3 store conforming to docs/specs/healpix-pyramid-zarr.md */
  url: string;
  /**
   * ColorMap LUT: exactly 256 × 4 = 1024 RGBA bytes (default: black→white).
   * Forwarded to HealpixCellsLayer for scalar color modes.
   */
  colorMap?: Uint8Array;
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
  /** Color mode forwarded to HealpixCellsLayer (RGB, scalar, etc.). */
  colorMode?: number;
  /** Shader modules injected into each tile's HealpixCellsLayer. */
  shaderModules?: ShaderModule[];
  /**
   * Called once when root metadata becomes available (and again if url changes).
   * Use this to populate a band-picker UI.
   */
  onMetadata?: (
    meta: ZarrPyramidMetadata,
    root: zarr.Group<CachedZarrStore>
  ) => void;
  /**
   * Called after each state update with rendering statistics.
   * Stable function reference recommended (useCallback / useState setter).
   */
  onStats?: (stats: HealpixZarrLayerStats) => void;
};

export type HealpixZarrTileLayerProps = _HealpixZarrTileLayerProps &
  Omit<TileLayerProps<HealpixZarrTileData | null>, 'getTileData'>;

// deck.gl's DefaultProps type does not cover all valid prop descriptor shapes
// (e.g. optional numbers with value:undefined, or 'string' type descriptors),
// so a single cast is needed here rather than per-prop `as any`.
const defaultProps = {
  url: { type: 'string', value: '' },
  colorMap: { type: 'object', value: undefined, optional: true, compare: true },
  filterMin: { type: 'number', value: undefined, optional: true },
  filterMax: { type: 'number', value: undefined, optional: true },
  rescaleMin: { type: 'number', value: undefined, optional: true },
  rescaleMax: { type: 'number', value: undefined, optional: true },
  bands: { type: 'object', value: null, compare: true },
  colorMode: { type: 'number', value: HEALPIX_COLOR_MODE_RGB },
  shaderModules: { type: 'object', value: [], compare: false },
  onMetadata: { type: 'function', value: undefined, compare: false },
  onStats: { type: 'function', value: undefined, compare: false },
  // Override TileLayer's default Tileset2D with our HEALPix-aware subclass.
  TilesetClass: HealpixTileset2D
} as unknown as DefaultProps<_HealpixZarrTileLayerProps>;

// ──────────────────────────────────────────────────────────────────────────────
// Layer
// ──────────────────────────────────────────────────────────────────────────────

export class HealpixZarrTileLayer extends TileLayer<
  HealpixZarrTileData | null,
  _HealpixZarrTileLayerProps
> {
  static layerName = 'HealpixZarrTileLayer';
  static defaultProps = defaultProps;

  // Narrow the tileset field from the base `Tileset2D | null` to our subclass.
  declare state: Omit<TileLayer['state'], 'tileset'> & {
    tileset: HealpixTileset2D | null;
    availableNsides: number[];
    parentLevels: number;
  };

  override initializeState(): void {
    super.initializeState();
    this._loadMetadata();
  }

  override updateState(params: UpdateParameters<this>): void {
    const { props, oldProps, changeFlags } = params;

    // When bands change, signal TileLayer to call tileset.reloadAll() via the
    // updateTriggersChanged.getTileData mechanism checks in its own updateState.
    if (changeFlags.propsChanged && props.bands !== oldProps.bands) {
      changeFlags.updateTriggersChanged = changeFlags.updateTriggersChanged
        ? {
            ...(changeFlags.updateTriggersChanged as Record<string, true>),
            getTileData: true
          }
        : { getTileData: true };
    }

    super.updateState(params);

    if (changeFlags.propsChanged && props.url !== oldProps.url) {
      this._loadMetadata();
    }

    this._emitStats();
  }

  private _emitStats(): void {
    const { onStats } = this.props;
    if (!onStats) return;

    const { tileset } = this.state;
    if (!tileset) return;

    // selectedTiles is public on Tileset2D but typed without a generic param;
    // cast once to our known DataT so tile.content is properly typed below.
    const selectedTiles = (tileset.selectedTiles ??
      []) as Tile2DHeader<HealpixZarrTileData | null>[];

    let nside = 0;
    if (selectedTiles.length > 0) {
      nside = tileset.nsideForOrder(selectedTiles[0].index.z);
    }
    const nsideParent = nside > 0 ? tileset.partitionNside(nside) : 0;

    let tilesRendered = 0;
    let cellsRendered = 0;
    for (const tile of selectedTiles) {
      // tile.content is the resolved DataT (set when isLoaded becomes true),
      // avoiding the Promise<DataT> | DataT union of tile.data.
      if (tile.isLoaded && tile.content) {
        tilesRendered++;
        cellsRendered += tile.content.cellIds.length;
      }
    }

    onStats({ nside, nsideParent, tilesRendered, cellsRendered });
  }

  private async _loadMetadata(): Promise<void> {
    const { url, onMetadata } = this.props;
    if (!url) return;
    try {
      const root = await getRoot(url);
      const meta = await loadRootMetadata(url);
      this.setState({
        availableNsides: meta.nsides,
        parentLevels: meta.parentLevels
      });
      this.state.tileset?.setOptions(this._getTilesetOptions());
      onMetadata?.(meta, root);
      this.setNeedsUpdate();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealpixZarrTileLayer] metadata load failed:', e);
    }
  }

  override _getTilesetOptions() {
    return {
      ...super._getTilesetOptions(),
      availableNsides: this.state?.availableNsides ?? [],
      parentLevels: this.state?.parentLevels
    };
  }

  override getTileData(tile: { index: unknown; signal?: AbortSignal }) {
    const { url, bands } = this.props;
    if (!bands || bands.length === 0) return Promise.resolve(null);
    const { x: parentCell, z } = tile.index as HealpixTileIndex;
    // tileset is always present when getTileData is invoked (TileLayer guarantee)
    const nside = this.state.tileset!.nsideForOrder(z);
    return getGroupHandle(url, nside).then((group) =>
      loadTileFromGroup(group, parentCell, bands, tile.signal)
    );
  }

  override renderSubLayers(
    props: TileLayer['props'] & {
      id: string;
      data: HealpixZarrTileData | null;
      _offset: number;
      tile: Tile2DHeader<HealpixZarrTileData | null>;
    }
  ) {
    const { data, tile } = props;
    if (!data || data.cellIds.length === 0) return null;

    return new HealpixCellsLayer({
      ...this.getSubLayerProps({ id: `tile-${tile.id}` }),
      nside: data.nside,
      cellIds: data.cellIds,
      values: data.values,
      dimensions: data.bands.length,
      colorMode: this.props.colorMode ?? HEALPIX_COLOR_MODE_RGB,
      colorMap: this.props.colorMap,
      rescaleMin: this.props.rescaleMin,
      rescaleMax: this.props.rescaleMax,
      filterMin: this.props.filterMin,
      filterMax: this.props.filterMax,
      shaderModules: this.props.shaderModules
    });
  }
}
