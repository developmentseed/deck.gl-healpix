import { type DefaultProps, type UpdateParameters } from '@deck.gl/core';
import {
  TileLayer,
  type TileLayerProps,
  type _Tile2DHeader as Tile2DHeader
} from '@deck.gl/geo-layers';
import {
  HEALPIX_COLOR_MODE_RGB,
  HealpixCellsLayer
} from '@developmentseed/deck.gl-healpix';
import type { ShaderModule } from '@luma.gl/shadertools';
import { HealpixTileset2D } from './healpix-tileset-2d';
import { createTileDebugLayers } from '../lib/tile-debug-layers';
import type { HealpixTileIndex, HealpixTileData } from '../types';

export type HealpixTileLayerStats = {
  nside: number;
  nsideParent: number;
  tilesRendered: number;
  cellsRendered: number;
};

type _HealpixTileLayerProps = {
  getTileData: (tile: {
    index: HealpixTileIndex;
    signal?: AbortSignal;
  }) => Promise<HealpixTileData | null>;
  colorMap?: Uint8Array;
  filterMin?: number;
  filterMax?: number;
  rescaleMin?: number;
  rescaleMax?: number;
  colorMode?: number;
  shaderModules?: ShaderModule[];
  debugTiles?: boolean;
  onStats?: (stats: HealpixTileLayerStats) => void;
};

export type HealpixTileLayerProps = _HealpixTileLayerProps &
  Omit<TileLayerProps<HealpixTileData | null>, 'getTileData'>;

// deck.gl's DefaultProps type does not cover all valid prop descriptor shapes,
// so a single cast is needed here rather than per-prop `as any`.
const defaultProps = {
  getTileData: {
    type: 'function',
    value: () => Promise.resolve(null),
    compare: false
  },
  colorMap: { type: 'object', value: undefined, optional: true, compare: true },
  filterMin: { type: 'number', value: undefined, optional: true },
  filterMax: { type: 'number', value: undefined, optional: true },
  rescaleMin: { type: 'number', value: undefined, optional: true },
  rescaleMax: { type: 'number', value: undefined, optional: true },
  colorMode: { type: 'number', value: HEALPIX_COLOR_MODE_RGB },
  shaderModules: { type: 'object', value: [], compare: false },
  debugTiles: { type: 'boolean', value: false },
  onStats: { type: 'function', value: undefined, compare: false },
  TilesetClass: HealpixTileset2D
} as unknown as DefaultProps<_HealpixTileLayerProps>;

export class HealpixTileLayer extends TileLayer<
  HealpixTileData | null,
  _HealpixTileLayerProps
> {
  static layerName = 'HealpixTileLayer';
  static defaultProps = defaultProps;

  // Narrow the tileset field from the base `Tileset2D | null` to our subclass.
  declare state: Omit<TileLayer['state'], 'tileset'> & {
    tileset: HealpixTileset2D | null;
  };

  override updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    this._emitStats();
  }

  /**
   * Re-invokes getTileData for tiles matching the filter predicate.
   * With no filter, all tiles are refreshed.
   * Accesses deck.gl's internal tile cache directly — no per-tile public reload API exists.
   */
  refreshTileData(filter?: (index: HealpixTileIndex) => boolean): void {
    const { tileset } = this.state;
    if (!tileset) return;
    if (!filter) {
      tileset.reloadAll();
      this.setNeedsUpdate();
      return;
    }
    const cache = (
      tileset as unknown as {
        _cache: Map<string, { index: unknown; reset(): void }>;
      }
    )._cache;
    for (const tile of cache.values()) {
      if (filter(tile.index as HealpixTileIndex)) {
        tile.reset();
      }
    }
    this.setNeedsUpdate();
  }

  private _emitStats(): void {
    const { onStats } = this.props;
    if (!onStats) return;
    const { tileset } = this.state;
    if (!tileset) return;

    const selectedTiles = (tileset.selectedTiles ??
      []) as Tile2DHeader<HealpixTileData | null>[];

    let nside = 0;
    if (selectedTiles.length > 0) {
      nside = tileset.nsideForOrder(selectedTiles[0].index.z);
    }
    const nsideParent = nside > 0 ? tileset.partitionNside(nside) : 0;

    let tilesRendered = 0;
    let cellsRendered = 0;
    for (const tile of selectedTiles) {
      if (tile.isLoaded && tile.content) {
        tilesRendered++;
        cellsRendered += tile.content.cellIds.length;
      }
    }

    onStats({ nside, nsideParent, tilesRendered, cellsRendered });
  }

  override renderSubLayers(
    props: TileLayer['props'] & {
      id: string;
      data: HealpixTileData | null;
      _offset: number;
      tile: Tile2DHeader<HealpixTileData | null>;
    }
  ) {
    const { data, tile } = props;
    if (!data || data.cellIds.length === 0) return null;

    const cellsLayer = new HealpixCellsLayer({
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

    if (!this.props.debugTiles) {
      return cellsLayer;
    }

    const index = tile.index as HealpixTileIndex;
    const partitionNside = this.state.tileset!.partitionNside(data.nside);
    const debugLayers = createTileDebugLayers({
      id: tile.id,
      parentCell: index.x,
      partitionNside,
      tileId: tile.id,
      getSubLayerProps: (extra) => this.getSubLayerProps(extra)
    });

    return [cellsLayer, ...debugLayers];
  }
}
