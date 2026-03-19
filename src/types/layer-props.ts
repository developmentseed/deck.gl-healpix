import type { CompositeLayerProps } from '@deck.gl/core';

/** HEALPix pixel numbering scheme. */
export type HealpixScheme = 'nest' | 'ring';

/** Each HEALPix cell polygon = 4 corners + closing vertex = 5 vertices. */
export const VERTS_PER_CELL = 5;

export type HealpixCellsLayerProps = {
  nside: number;
  /** HEALPix cell indices. */
  cellIds: Int32Array;
  /** Numbering scheme. */
  scheme: HealpixScheme;
  /**
   * Per-cell fill color as a Float32Array of RGBA values normalised 0-1.
   * Length must equal cellIds.length * 4.
   */
  getFillColor: Float32Array;
} & CompositeLayerProps;
