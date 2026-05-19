/**
 * Tile index for a single HEALPix data tile, used by deck.gl's TileLayer.
 *
 * ### Coordinate semantics
 *
 * **z** — HEALPix *order* of the data resolution: `data_nside = 2^z`.
 * This selects which Zarr group to open, e.g. `nside_512/` for z = 9.
 *
 * **x** — Cell number in NESTED ordering at the *partition* (coarser) nside,
 * where `partition_nside = HealpixTileset2D.partitionNside(data_nside)`.
 * All data cells within a tile share this ancestor cell.
 *
 * In the Zarr group each resolution level stores a CSR (compressed-sparse-row)
 * index called `parent_offsets`.  The row range for tile x is
 * `bands/<name>[parent_offsets[x] : parent_offsets[x+1]]`, so x is the direct key
 * into that index.
 *
 * **y** — This value is not used but it stores the HEALPix order of the parent nside.
 */
export interface HealpixTileIndex {
  /** Parent cell at partition_nside in NESTED ordering — the tile key. */
  x: number;
  /** HEALPix order: parent_nside = 2^y. Not used, just a useful placeholder. */
  y: number;
  /** HEALPix order: data_nside = 2^z. */
  z: number;
}

export interface HealpixZarrTileData {
  nside: number;
  cellIds: Float64Array;
  values: Float32Array;
  bands: string[];
}
