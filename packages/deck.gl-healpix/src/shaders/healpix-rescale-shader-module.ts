import type { ShaderModule } from '@luma.gl/shadertools';

export type HealpixRescaleProps = {
  uRescaleMin: number;
  uRescaleMax: number;
};

export const healpixRescaleShaderModule = {
  name: 'healpixRescale',
  fs: `\
uniform healpixRescaleUniforms {
  float uRescaleMin;
  float uRescaleMax;
} healpixRescale;
`,
  inject: {
    'fs:DECKGL_FILTER_COLOR': {
      order: -20,
      injection: `\
if (
  healpixColorMode == HEALPIX_COLOR_MODE_SCALAR ||
  healpixColorMode == HEALPIX_COLOR_MODE_SCALAR_ALPHA
) {
  float healpixRescaleDenom =
    healpixRescale.uRescaleMax - healpixRescale.uRescaleMin;
  healpixSelectedValues.x = healpixRescaleDenom == 0.0
    ? 0.0
    : clamp(
        (healpixSelectedValues.x - healpixRescale.uRescaleMin) /
          healpixRescaleDenom,
        0.0,
        1.0
      );
}

HEALPIX_RESCALE_VALUES(healpixSelectedValues, geometry);
`
    }
  },
  uniformTypes: {
    uRescaleMin: 'f32',
    uRescaleMax: 'f32'
  }
} as const satisfies ShaderModule<HealpixRescaleProps>;
