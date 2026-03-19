import type { Texture } from '@luma.gl/core';
import type { ShaderModule } from '@luma.gl/shadertools';

/**
 * Uniform/binding props consumed by the HEALPix color-frame shader module.
 *
 * - `frameIndex` selects the active frame layer in the texture array.
 * - `cellTextureWidth` is used to map linear cell index -> texture x/y.
 * - `healpixFramesTexture` is a folded `2d-array` RGBA texture.
 */
export type HealpixColorFramesProps = {
  frameIndex: number;
  cellTextureWidth: number;
  healpixFramesTexture: Texture;
};

/**
 * Shader module that exposes frame selection uniform(s) to the vertex shader.
 *
 * The texture binding itself is supplied via `model.shaderInputs.setProps()` in the
 * extension draw hook.
 */
export const healpixColorFramesShaderModule = {
  name: 'healpixColorFrames',
  vs: `\
uniform healpixColorFramesUniforms {
  int frameIndex;
  int cellTextureWidth;
} healpixColorFrames;
`,
  uniformTypes: {
    frameIndex: 'i32',
    cellTextureWidth: 'i32'
  }
} as const satisfies ShaderModule<HealpixColorFramesProps>;
