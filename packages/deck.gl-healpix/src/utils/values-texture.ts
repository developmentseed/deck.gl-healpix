/**
 * Packs per-cell interleaved float values into an `RGBA32F` 2D texture layout.
 *
 * The texture is folded: each cell owns `ceil(dimensions / 4)` adjacent texels
 * in linear order, then that linear texel stream is folded into 2D.
 *
 * @param values         Interleaved float values. Length = cellCount × dimensions.
 * @param dimensions     Number of source values per cell.
 * @param cellCount      Total number of cells.
 * @param maxTextureSize GPU max texture dimension (from device limits).
 */
export function packValuesData(
  values: ArrayLike<number>,
  dimensions: number,
  cellCount: number,
  maxTextureSize: number
): {
  data: Float32Array;
  width: number;
  height: number;
  texelsPerCell: number;
} {
  const texelsPerCell = Math.max(1, Math.ceil(dimensions / 4));
  if (cellCount === 0) {
    return { data: new Float32Array(4), width: 1, height: 1, texelsPerCell };
  }

  const texelCount = cellCount * texelsPerCell;
  const width = Math.min(texelCount, maxTextureSize);
  const height = Math.ceil(texelCount / width);
  const data = new Float32Array(width * height * 4);

  for (let i = 0; i < cellCount; i++) {
    const srcBase = i * dimensions;
    for (let d = 0; d < dimensions; d++) {
      const linearTexel = i * texelsPerCell + Math.floor(d / 4);
      const x = linearTexel % width;
      const y = Math.floor(linearTexel / width);
      const dstBase = (y * width + x) * 4;
      data[dstBase + (d % 4)] = (values as number[])[srcBase + d] ?? 0;
    }
  }

  return { data, width, height, texelsPerCell };
}
