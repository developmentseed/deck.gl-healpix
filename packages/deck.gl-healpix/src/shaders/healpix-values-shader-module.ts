import type { Texture } from '@luma.gl/core';
import type { ShaderModule } from '@luma.gl/shadertools';

export type HealpixValuesProps = {
  uDimensions: number;
  uColorMode: number;
  uValuesWidth: number;
  uTexelsPerCell: number;
  healpixValuesTexture: Texture;
};

export const healpixValuesShaderModule = {
  name: 'healpixValues',
  fs: `\
in float vHealpixCellIndex;
uniform highp sampler2D healpixValuesTexture;

uniform healpixValuesUniforms {
  int uDimensions;
  int uColorMode;
  int uValuesWidth;
  int uTexelsPerCell;
} healpixValues;

const int HEALPIX_COLOR_MODE_SCALAR = 1;
const int HEALPIX_COLOR_MODE_SCALAR_ALPHA = 2;
const int HEALPIX_COLOR_MODE_RGB = 3;
const int HEALPIX_COLOR_MODE_RGBA = 4;

int healpixCell;
int healpixDimensions;
int healpixColorMode;
vec4 healpixSelectedValues;

// Forward declarations for the custom HEALPix hooks. The hook system emits
// the no-op bodies (and any user injections) after the deck.gl hook bodies,
// but our injections call them from inside DECKGL_FILTER_COLOR. GLSL requires
// a declaration before the call site, so declare them here.
void HEALPIX_SELECT_VALUES(inout vec4 selectedValues, FragmentGeometry geometry);
void HEALPIX_RESCALE_VALUES(inout vec4 selectedValues, FragmentGeometry geometry);

float healpixValueAt(int channel) {
  if (channel < 0 || channel >= healpixDimensions) {
    return 0.0;
  }

  int texel = channel / 4;
  int component = channel - texel * 4;
  int valueIndex = healpixCell * healpixValues.uTexelsPerCell + texel;
  int x = valueIndex % healpixValues.uValuesWidth;
  int y = valueIndex / healpixValues.uValuesWidth;
  vec4 rgba = texelFetch(healpixValuesTexture, ivec2(x, y), 0);

  if (component == 0) return rgba.r;
  if (component == 1) return rgba.g;
  if (component == 2) return rgba.b;
  if (component == 3) return rgba.a;
  return 0.0;
}
`,
  inject: {
    'fs:DECKGL_FILTER_COLOR': {
      order: -40,
      injection: `\
healpixCell = int(vHealpixCellIndex + 0.5);
healpixDimensions = healpixValues.uDimensions;
healpixColorMode = healpixValues.uColorMode;
healpixSelectedValues = vec4(0.0);

if (healpixDimensions >= 1) healpixSelectedValues.x = healpixValueAt(0);
if (healpixDimensions >= 2) healpixSelectedValues.y = healpixValueAt(1);
if (healpixDimensions >= 3) healpixSelectedValues.z = healpixValueAt(2);
if (healpixDimensions >= 4) healpixSelectedValues.w = healpixValueAt(3);

HEALPIX_SELECT_VALUES(healpixSelectedValues, geometry);
`
    }
  },
  uniformTypes: {
    uDimensions: 'i32',
    uColorMode: 'i32',
    uValuesWidth: 'i32',
    uTexelsPerCell: 'i32'
  }
} as const satisfies ShaderModule<HealpixValuesProps>;
