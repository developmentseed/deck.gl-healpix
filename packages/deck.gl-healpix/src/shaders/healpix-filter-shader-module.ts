import type { ShaderModule } from '@luma.gl/shadertools';

export type HealpixFilterProps = {
  uFilterMin: number;
  uFilterMax: number;
};

export const healpixFilterShaderModule = {
  name: 'healpixFilter',
  fs: `\
uniform healpixFilterUniforms {
  float uFilterMin;
  float uFilterMax;
} healpixFilter;
`,
  inject: {
    'fs:DECKGL_FILTER_COLOR': {
      order: -30,
      injection: `\
if (
  healpixColorMode == HEALPIX_COLOR_MODE_SCALAR ||
  healpixColorMode == HEALPIX_COLOR_MODE_SCALAR_ALPHA
) {
  float healpixFilterValue = healpixSelectedValues.x;
  if (
    healpixFilterValue < healpixFilter.uFilterMin ||
    healpixFilterValue > healpixFilter.uFilterMax
  ) {
    discard;
  }
}
`
    }
  },
  uniformTypes: {
    uFilterMin: 'f32',
    uFilterMax: 'f32'
  }
} as const satisfies ShaderModule<HealpixFilterProps>;
