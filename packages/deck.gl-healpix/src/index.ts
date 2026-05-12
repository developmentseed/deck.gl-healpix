export { HealpixCellsLayer } from './layers/healpix-cells-layer';
export { splitCellIds } from './utils/split-cell-ids';
export { makeColorMap } from './utils/color-map';
export type {
  ColorMapCallbackValue,
  NormalizedColorArray,
  Uint8ColorArray
} from './utils/color-map';
export type { CellIdArray } from './types/cell-ids';
export type {
  HealpixColorMode,
  HealpixCellsLayerProps,
  HealpixFrameObject,
  HealpixScheme
} from './types/layer-props';
export {
  HEALPIX_COLOR_MODE_RGBA,
  HEALPIX_COLOR_MODE_RGB,
  HEALPIX_COLOR_MODE_SCALAR,
  HEALPIX_COLOR_MODE_SCALAR_ALPHA
} from './types/layer-props';
