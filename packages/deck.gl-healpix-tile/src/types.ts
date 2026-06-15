/**
 * Tile index for a single HEALPix data tile, used by deck.gl's TileLayer.
 *
 * z — HEALPix order of the data resolution: data_nside = 2^z.
 * x — Cell number in NESTED ordering at the partition (coarser) nside.
 * y — HEALPix order of the partition nside. Not used for indexing.
 */
export interface HealpixTileIndex {
  x: number;
  y: number;
  z: number;
}

export interface HealpixTileData {
  nside: number;
  cellIds: Float64Array;
  values: Float32Array;
  bands: string[];
}
