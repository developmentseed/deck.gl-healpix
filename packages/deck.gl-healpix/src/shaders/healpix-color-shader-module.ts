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
      // Scalar modes look up a 256-entry LUT: the rescaled value in [0, 1] is
      // scaled to [0, 255] and used as the texel index. We `+ 0.5` to round to
      // the NEAREST slot (slot `i` represents position `i / 255`, per
      // makeColorMap) rather than truncating toward zero. Truncation biases
      // continuous data downward and, critically, breaks integer-indexed LUTs
      // on GPUs that honour `mediump` as fp16 (e.g. Windows/ANGLE→D3D): there
      // `n / 255 * 255` evaluates to `n - ε`, which truncates to `n - 1` and
      // shifts every entry to the previous slot. Rounding tolerates that ±0.5.
      injection: `\
if (healpixColorMode == HEALPIX_COLOR_MODE_SCALAR) {
  color = texelFetch(
    healpixColorMapTexture,
    ivec2(int(healpixSelectedValues.x * 255.0 + 0.5), 0),
    0
  );
} else if (healpixColorMode == HEALPIX_COLOR_MODE_SCALAR_ALPHA) {
  color = texelFetch(
    healpixColorMapTexture,
    ivec2(int(healpixSelectedValues.x * 255.0 + 0.5), 0),
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
