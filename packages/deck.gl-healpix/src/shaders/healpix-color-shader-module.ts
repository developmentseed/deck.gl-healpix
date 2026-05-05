import type { Texture } from '@luma.gl/core';
import type { ShaderModule } from '@luma.gl/shadertools';

export type HealpixColorProps = {
  healpixColorMapTexture: Texture;
};

export const healpixColorShaderModule = {
  name: 'healpixColor',
  fs: `\
uniform mediump sampler2D healpixColorMapTexture;
`,
  inject: {
    'fs:DECKGL_FILTER_COLOR': {
      order: -10,
      injection: `\
if (healpixColorMode == HEALPIX_COLOR_MODE_SCALAR) {
  color = texelFetch(
    healpixColorMapTexture,
    ivec2(int(healpixSelectedValues.x * 255.0), 0),
    0
  );
} else if (healpixColorMode == HEALPIX_COLOR_MODE_SCALAR_ALPHA) {
  color = texelFetch(
    healpixColorMapTexture,
    ivec2(int(healpixSelectedValues.x * 255.0), 0),
    0
  );
  color.a *= healpixSelectedValues.y;
} else if (healpixColorMode == HEALPIX_COLOR_MODE_RGB) {
  color = vec4(healpixSelectedValues.rgb, 1.0);
} else if (healpixColorMode == HEALPIX_COLOR_MODE_RGBA) {
  color = healpixSelectedValues;
} else {
  color = vec4(0.0);
}

color.a *= layer.opacity;
`
    }
  }
} as const satisfies ShaderModule<HealpixColorProps>;
