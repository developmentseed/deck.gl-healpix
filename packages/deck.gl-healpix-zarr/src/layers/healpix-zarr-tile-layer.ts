import type { UpdateParameters } from '@deck.gl/core';
import * as zarr from 'zarrita';
import {
  HealpixTileLayer,
  HealpixTileset2D,
  type HealpixTileLayerProps,
  type HealpixTileIndex
} from '@developmentseed/deck.gl-healpix-tile';
import {
  getRoot,
  getGroupHandle,
  loadRootMetadata,
  loadTileFromGroup
} from '../zarr/zarr-pyramid';
import type { ZarrPyramidMetadata } from '../zarr/zarr-pyramid';
import type { CachedZarrStore } from '../zarr/cached-zarr-store';

// -----------------------------------------------------------------------------
// Layer props
// -----------------------------------------------------------------------------

type _HealpixZarrTileLayerProps = {
  /** URL of the Zarr v3 store conforming to docs/specs/healpix-pyramid-zarr.md */
  url: string;
  /**
   * Bands to load and render. null = wait (render nothing).
   * Order determines column order in the interleaved values array.
   */
  bands: string[] | null;
  /**
   * Called once when root metadata becomes available (and again if url changes).
   * Use this to populate a band-picker UI.
   */
  onMetadata?: (
    meta: ZarrPyramidMetadata,
    root: zarr.Group<CachedZarrStore>
  ) => void;
};

export type HealpixZarrTileLayerProps = _HealpixZarrTileLayerProps &
  Omit<HealpixTileLayerProps, 'getTileData' | 'data'>;

// Spread parent defaultProps so the inferred type is a structural superset of
// the base class's static field type. deck.gl still merges at runtime, but
// TypeScript requires the static side to be assignable to the parent's.
const defaultProps = {
  ...HealpixTileLayer.defaultProps,
  url: { type: 'string', value: '' },
  bands: { type: 'object', value: null, compare: true },
  onMetadata: { type: 'function', value: undefined, compare: false }
};

// -----------------------------------------------------------------------------
// Layer
// -----------------------------------------------------------------------------

export class HealpixZarrTileLayer extends HealpixTileLayer<_HealpixZarrTileLayerProps> {
  static layerName = 'HealpixZarrTileLayer';
  static defaultProps = defaultProps;

  declare state: Omit<HealpixTileLayer['state'], 'tileset'> & {
    tileset: HealpixTileset2D | null;
    availableNsides: number[];
    parentLevels: number;
  };

  override initializeState(): void {
    super.initializeState();
    this._loadMetadata();
  }

  override updateState(params: UpdateParameters<this>): void {
    const { changeFlags } = params;

    // When bands change, signal TileLayer to call tileset.reloadAll() via the
    // updateTriggersChanged.getTileData mechanism in its own updateState.
    if (
      changeFlags.propsChanged &&
      params.props.bands !== params.oldProps.bands
    ) {
      changeFlags.updateTriggersChanged = changeFlags.updateTriggersChanged
        ? {
            ...(changeFlags.updateTriggersChanged as Record<string, true>),
            getTileData: true
          }
        : { getTileData: true };
    }

    super.updateState(params);

    if (changeFlags.propsChanged && params.props.url !== params.oldProps.url) {
      this._loadMetadata();
    }
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
}
