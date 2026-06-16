import {
  _Tileset2D as Tileset2D,
  type _Tileset2DProps as Tileset2DProps
} from '@deck.gl/geo-layers';
import { queryBoxInclusiveNest, nside2order, pix2LonLatNest } from 'healpix-ts';
import { sortTileIndicesByViewportCenter } from './sort-by-distance';
import type { HealpixTileIndex } from './types';
import { getNsideForZoom, clampToAvailable } from './utils';

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
 * Compute a LOD-adjusted tile index for a single partition-level cell.
 *
 * When `viewport.project` is available, reduces the data nside for tiles that
 * project to a small screen footprint (e.g., far tiles in a tilted viewport).
 * Falls back to `baseNside` for all tiles when `project` is absent (e.g., in
 * tests that use a minimal viewport mock).
 *
 * @param xBase              Cell number at basePartitionNside (NESTED ordering).
 * @param basePartitionNside Partition nside for the current zoom level.
 * @param baseNside          Maximum data nside (from nsideForZoom).
 * @param parentLevels       Levels separating data nside from partition nside.
 * @param viewport           Deck.gl viewport — zoom and optional project.
 * @param availableNsides    Nsides present in the Zarr pyramid.
 */
export function computePerTileLOD(
  xBase: number,
  basePartitionNside: number,
  baseNside: number,
  parentLevels: number,
  viewport: {
    zoom: number;
    height?: number;
    pitch?: number;
    project?(xy: number[]): number[];
  },
  availableNsides: number[]
): HealpixTileIndex {
  const partitionNsideFn = (n: number): number =>
    Math.max(1, n >> parentLevels);

  // Only consider nsides at or below the base level (LOD can only reduce, not increase).
  const nsidesToConsider = availableNsides.filter((n) => n <= baseNside);
  const minNside = nsidesToConsider.reduce((a, b) => Math.min(a, b), baseNside);

  /** Build a HealpixTileIndex for the given data nside, remapping x to its new partition. */
  const makeTile = (ndata: number): HealpixTileIndex => {
    const partNside = partitionNsideFn(ndata);
    const levelDiff = nside2order(basePartitionNside) - nside2order(partNside);
    // Math.floor instead of >> to stay safe with cell indices beyond 2^31.
    const xd = Math.floor(xBase / Math.pow(4, levelDiff));
    return { x: xd, y: nside2order(partNside), z: nside2order(ndata) };
  };

  // Fallback: no projection capability → return base nside unchanged.
  if (!viewport.project) {
    return makeTile(baseNside);
  }

  const [lon, lat] = pix2LonLatNest(basePartitionNside, xBase);
  const [, sy1] = viewport.project([lon, lat]);

  // No height available (e.g. test mocks without pitch support) → skip LOD bands.
  if (!viewport.height) {
    return makeTile(baseNside);
  }

  // Map normalised screen-Y to nside fraction. In a flat-map (pitched) viewport
  // top of screen = far = low detail, bottom = near = full detail.
  // Each entry is [yThreshold, nsideFraction] where y = sy1 / viewport.height.
  // Band effect is scaled by pitch: at pitch=0 all tiles get full detail.
  const LOD_BANDS: [number, number][] = [
    [0.2, 0.4],
    [0.4, 0.8],
    [1.0, 1.0]
  ];
  const pitchFactor = Math.min((viewport.pitch ?? 0) / 60, 1.0);
  const normalizedY = sy1 / viewport.height;
  const bandFraction = LOD_BANDS.find(([t]) => normalizedY <= t)?.[1] ?? 1.0;
  const fraction = 1.0 - (1.0 - bandFraction) * pitchFactor;
  const targetNside = Math.round(baseNside * fraction);
  const ndata = clampToAvailable(
    Math.max(targetNside, minNside),
    nsidesToConsider
  );

  return makeTile(ndata);
}

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
    viewport: {
      zoom: number;
      height?: number;
      pitch?: number;
      getBounds(): [number, number, number, number];
      project?(xy: number[]): number[];
    };
  }): HealpixTileIndex[] {
    if (this._availableNsides.length === 0) return [];

    const baseNside = this.nsideForZoom(viewport.zoom);
    const basePartitionNside = this.partitionNside(baseNside);
    const bbox = viewport.getBounds();
    const candidates = queryBoxInclusiveNest(basePartitionNside, bbox);

    // Apply per-tile LOD: each candidate cell may receive a different data nside.
    const raw = candidates.map((xBase) =>
      computePerTileLOD(
        xBase,
        basePartitionNside,
        baseNside,
        this._parentLevels,
        viewport,
        this._availableNsides
      )
    );

    // Deduplicate: multiple base-partition cells can collapse to the same lower-nside tile.
    const seen = new Set<string>();
    const deduped = raw.filter((idx) => {
      const id = this.getTileId(idx);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    return sortTileIndicesByViewportCenter(deduped, viewport);
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
