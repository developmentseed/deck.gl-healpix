import type { CompositeLayerProps } from '@deck.gl/core';
import type { ShaderModule } from '@luma.gl/shadertools';
import type { CellIdArray } from './cell-ids';

/** HEALPix pixel numbering scheme. */
export type HealpixScheme = 'nest' | 'ring';

export const HEALPIX_COLOR_MODE_SCALAR = 1;
export const HEALPIX_COLOR_MODE_SCALAR_ALPHA = 2;
export const HEALPIX_COLOR_MODE_RGB = 3;
export const HEALPIX_COLOR_MODE_RGBA = 4;

export type HealpixColorMode =
  | typeof HEALPIX_COLOR_MODE_SCALAR
  | typeof HEALPIX_COLOR_MODE_SCALAR_ALPHA
  | typeof HEALPIX_COLOR_MODE_RGB
  | typeof HEALPIX_COLOR_MODE_RGBA;

export type { CellIdArray };

/**
 * One animation frame of HEALPix cell data.
 *
 * All fields are optional — any field not set here falls back to the
 * matching root-level prop on `HealpixCellsLayerProps`.
 *
 * `values` is the only field with no root-level equivalent: it must be
 * present either here or at the root (via `HealpixCellsLayerProps.values`).
 *
 * ## `values` layout
 *
 * `values` is an interleaved flat array. Cell `i` occupies indices
 * `i * dimensions` through `i * dimensions + dimensions - 1`.
 *
 * `dimensions` is the number of source values per cell. `colorMode` controls
 * how selected values are interpreted for rendering.
 */
export type HealpixFrameObject = {
  /** Overrides root `nside`. */
  nside?: number;
  /** Overrides root `scheme`. Default: `'nest'`. */
  scheme?: HealpixScheme;
  /** Overrides root `cellIds`. */
  cellIds?: CellIdArray;
  /**
   * Per-cell float values. Interleaved: cell `i` starts at index
   * `i * dimensions`. Length must equal `cellIds.length * dimensions`.
   */
  values?: ArrayLike<number>;
  /** Overrides root `min`. Default: `0`. */
  min?: number;
  /** Overrides root `max`. Default: `1`. */
  max?: number;
  /** Render interpretation for selected values. Default: `HEALPIX_COLOR_MODE_SCALAR`. */
  colorMode?: HealpixColorMode;
  /** Inclusive lower visibility bound for dimensions 1 and 2. Default: unbounded. */
  filterMin?: number;
  /** Inclusive upper visibility bound for dimensions 1 and 2. Default: unbounded. */
  filterMax?: number;
  /**
   * Value mapped to colorMap index 0 for dimensions 1 and 2.
   * Defaults to `min` for backwards compatibility, then `0`.
   */
  rescaleMin?: number;
  /**
   * Value mapped to colorMap index 255 for dimensions 1 and 2.
   * Defaults to `max` for backwards compatibility, then `1`.
   */
  rescaleMax?: number;
  /**
   * Number of source values per cell. Default: `1`.
   */
  dimensions?: number;
  /**
   * ColorMap LUT: exactly 256 × 4 = 1024 RGBA bytes.
   * Index 0 maps to `min`, index 255 maps to `max`.
   * Default: linear black → white gradient.
   */
  colorMap?: Uint8Array;
};

/**
 * Props for `HealpixCellsLayer`.
 *
 * ## Single-frame usage
 *
 * Omit `frames` and set `nside`, `cellIds`, and `values` directly:
 *
 * ```tsx
 * <HealpixCellsLayer nside={512} cellIds={ids} values={vals} />
 * ```
 *
 * ## Multi-frame usage
 *
 * Root-level props act as shared defaults. Each `frames` entry overrides
 * selectively. Switch frames by updating `currentFrame`.
 *
 * ```tsx
 * <HealpixCellsLayer
 *   nside={512}
 *   colorMap={myLut}
 *   frames={[
 *     { cellIds: ids0, values: vals0 },
 *     { cellIds: ids1, values: vals1, min: -1 },
 *     { nside: 1024, cellIds: ids2, values: vals2 },
 *   ]}
 *   currentFrame={activeFrame}
 * />
 * ```
 *
 * ## Color pipeline
 *
 * `dimensions` is the number of source values per cell. `colorMode` controls
 * how selected values are interpreted for rendering.
 */
export type HealpixCellsLayerProps = {
  /**
   * HEALPix resolution parameter (power of 2, up to 262144).
   * Required at render time: set here or on every frame object.
   */
  nside: number;
  /**
   * HEALPix cell indices.
   * Required at render time: set here or on every frame object.
   */
  cellIds: CellIdArray;
  /** Numbering scheme. Default: `'nest'`. */
  scheme?: HealpixScheme;
  /**
   * Per-cell values for single-frame mode (when `frames` is absent).
   * Interleaved: cell `i` starts at index `i * dimensions`.
   * Length must equal `cellIds.length * dimensions`.
   */
  values?: ArrayLike<number>;
  /**
   * Value mapped to colorMap index 0. Default: `0`.
   * @deprecated Use `rescaleMin` instead.
   */
  min?: number;
  /**
   * Value mapped to colorMap index 255. Default: `1`.
   * @deprecated Use `rescaleMax` instead.
   */
  max?: number;
  /** Render interpretation for selected values. Default: `HEALPIX_COLOR_MODE_SCALAR`. */
  colorMode?: HealpixColorMode;
  /** Inclusive lower visibility bound for dimensions 1 and 2. Default: unbounded. */
  filterMin?: number;
  /** Inclusive upper visibility bound for dimensions 1 and 2. Default: unbounded. */
  filterMax?: number;
  /**
   * Value mapped to colorMap index 0 for dimensions 1 and 2.
   * Defaults to `min` for backwards compatibility, then `0`.
   */
  rescaleMin?: number;
  /**
   * Value mapped to colorMap index 255 for dimensions 1 and 2.
   * Defaults to `max` for backwards compatibility, then `1`.
   */
  rescaleMax?: number;
  /**
   * Number of source values per cell. Default: `1`.
   */
  dimensions?: number;
  /**
   * ColorMap LUT: exactly 256 × 4 = 1024 RGBA bytes (default: black→white).
   * Used as a shared default when frames do not provide their own colorMap.
   */
  colorMap?: Uint8Array;
  /** Animation frames. When absent, the layer renders a single frame from root props. */
  frames?: HealpixFrameObject[];
  /** Active frame index into `frames`. Clamped to `[0, frames.length - 1]`. Default: `0`. */
  currentFrame?: number;
  /** Custom shader modules appended after the built-in HEALPix color pipeline. */
  shaderModules?: ShaderModule[];
} & CompositeLayerProps;
