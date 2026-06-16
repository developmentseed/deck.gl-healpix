export const RGB_STRETCH = 0.3;

const stretch = (1 / RGB_STRETCH).toFixed(6);

/** Shader module injected into every tile for RGB composites.
 * Bands are loaded in [r, g, b] order → indices 0, 1, 2. */
export const RGB_COMPOSITE_MODULE = {
  name: 'healpixSelector_rgb',
  inject: {
    'fs:HEALPIX_SELECT_VALUES': `\
const float kStretch = ${stretch};
selectedValues = vec4(
  clamp(healpixValueAt(0) * kStretch, 0.0, 1.0),
  clamp(healpixValueAt(1) * kStretch, 0.0, 1.0),
  clamp(healpixValueAt(2) * kStretch, 0.0, 1.0),
  1.0
);
`
  }
};

/** Shader module for NDVI. Bands loaded as: b04=red @ idx 0, b8a=nir @ idx 1. */
export const NDVI_MODULE = {
  name: 'healpixSelector_ndvi',
  inject: {
    'fs:HEALPIX_SELECT_VALUES': `\
float red = healpixValueAt(0);
float nir = healpixValueAt(1);
float denom = max(red + nir, 1e-6);
float ndvi = (nir - red) / denom;
selectedValues = vec4(ndvi, 0.0, 0.0, 0.0);
`
  }
};
