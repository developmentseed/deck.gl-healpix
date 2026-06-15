// Minimal stub for @developmentseed/deck.gl-healpix used in Jest.
export const HEALPIX_COLOR_MODE_RGB = 0;

export class HealpixCellsLayer {
  static layerName = 'HealpixCellsLayer';
  static defaultProps = {};
  constructor(public props: Record<string, unknown> = {}) {}
}
