import type { ShaderModule } from '@luma.gl/shadertools';

export type HealpixCellsProps = {
  nside: number;
  scheme: number;
};

export const healpixCellsShaderModule = {
  name: 'healpixCells',
  vs: `\
uniform healpixCellsUniforms {
  uint nside;
  int scheme;
} healpixCells;
`,
  uniformTypes: {
    nside: 'u32',
    scheme: 'i32'
  }
} as const satisfies ShaderModule<HealpixCellsProps>;
