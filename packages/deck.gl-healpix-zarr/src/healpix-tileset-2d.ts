import {
  _Tileset2D as Tileset2D,
  type _Tileset2DProps as Tileset2DProps
} from '@deck.gl/geo-layers';
import { queryBoxInclusiveNest, nside2order } from 'healpix-ts';
import { getNsideForZoom } from './utils';
import type { HealpixTileIndex } from './types';

// Extra fields accepted by setOptions (and optionally by the constructor).
type HealpixExtras = {
  availableNsides?: number[];
  zoomOffset?: number;
  /**
   * Number of HEALPix levels between the data nside and the partition nside.
   * partition_nside = max(1, data_nside / 2^parentLevels).
   * @default 6
   */
  parentLevels?: number;
  /**
   * getTileData is provided by TileLayer at runtime and not required in
   * options, but it may be passed through the spread so we accept it here.
   */
  getTileData?: Tileset2DProps['getTileData'];
};

export type HealpixTileset2DOptions = Omit<Tileset2DProps, 'getTileData'> &
  HealpixExtras;

/**
 * Tileset2D subclass that maps deck.gl viewports to HEALPix tile indices.
 *
 * ## Tile coordinate system
 *
 * Each tile is identified by `{ x, y, z }` (see {@link HealpixTileIndex}):
 *
 *   z  — HEALPix *order* of the data resolution: `data_nside = 2^z`.
 *         This selects which Zarr group to open (e.g. `nside_512/` for z = 9).
 *
 *   x  — Cell number in NESTED ordering at the *partition* (coarser) nside,
 *         where `partition_nside = max(1, data_nside >> parentLevels)`.
 *         All data cells within the tile share this ancestor. In the Zarr
 *         group the `parent_offsets` array is a CSR index keyed on these
 *         parent cell numbers: loading tile (z, x) means slicing
 *         `bands/<name>[parent_offsets[x] : parent_offsets[x+1]]`.
 *
 *   y  — HEALPix *order* of the partition nside: `partition_nside = 2^y`.
 *         Not used for spatial indexing; carried in tile ids and parent lookup.
 */
export class HealpixTileset2D extends Tileset2D {
  private _availableNsides: number[];
  private _zoomOffset: number;
  private _parentLevels: number;

  constructor(opts: HealpixTileset2DOptions) {
    super({
      ...opts,
      // getTileData is provided by TileLayer at runtime; stub it here for testing
      getTileData: opts.getTileData ?? (() => Promise.resolve(null))
    });
    // Fields are initialised via setOptions, which the base constructor already called.
    this._availableNsides ??= [];
    this._zoomOffset ??= 5;
    this._parentLevels ??= 6;
  }

  override setOptions(opts: Tileset2DProps & HealpixExtras): void {
    super.setOptions(opts);
    if (opts.availableNsides !== undefined) {
      this._availableNsides = opts.availableNsides;
    }
    if (opts.zoomOffset !== undefined) {
      this._zoomOffset = opts.zoomOffset;
    }
    if (opts.parentLevels !== undefined) {
      this._parentLevels = opts.parentLevels;
    }
  }

  // ── nside / order helpers ─────────────────────────────────────────────────

  /**
   * Returns the data nside appropriate for `zoom`, clamped to the available
   * nsides declared in the Zarr pyramid metadata.
   */
  nsideForZoom(zoom: number): number {
    return getNsideForZoom(zoom, this._zoomOffset, this._availableNsides);
  }

  /**
   * Converts a HEALPix order (the `z` field in a tile index) to nside.
   * `nside = 2^order`.
   */
  nsideForOrder(order: number): number {
    return 1 << order;
  }

  /**
   * Returns the partition (tile-key) nside for a given data nside.
   * `partition_nside = max(1, nside >> parentLevels)`.
   *
   * Every data cell at `nside` has a unique ancestor at `partitionNside`;
   * that ancestor's cell number becomes the tile's `x` coordinate.
   */
  partitionNside(nside: number): number {
    return Math.max(1, nside >> this._parentLevels);
  }

  // ── Tileset2D overrides ────────────────────────────────────────────────────

  override getTileIndices({
    viewport
  }: {
    viewport: { zoom: number; getBounds(): [number, number, number, number] };
  }): HealpixTileIndex[] {
    if (this._availableNsides.length === 0) return [];

    const nside = this.nsideForZoom(viewport.zoom);
    const z = nside2order(nside);
    const nsideParent = this.partitionNside(nside);
    const y = nside2order(nsideParent);
    const bbox = viewport.getBounds();
    const cells = queryBoxInclusiveNest(nsideParent, bbox);
    return cells.map((x) => ({ x, y, z }));
  }

  override getTileId(index: HealpixTileIndex): string {
    return `${index.z}-${index.y}-${index.x}`;
  }

  override getTileZoom(index: HealpixTileIndex): number {
    return index.z;
  }

  override getParentIndex(index: HealpixTileIndex): HealpixTileIndex {
    const z = index.z - 1;
    const y = nside2order(this.partitionNside(1 << z));
    return { x: Math.floor(index.x / 4), y, z };
  }
}
