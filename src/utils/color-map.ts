/**
 * Default colorMap: linear black (0,0,0,255) → white (255,255,255,255) gradient.
 * 256 entries × 4 bytes (RGBA) = 1024 bytes.
 */
export const DEFAULT_COLORMAP: Uint8Array = (() => {
  const map = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    map[i * 4 + 0] = i;
    map[i * 4 + 1] = i;
    map[i * 4 + 2] = i;
    map[i * 4 + 3] = 255;
  }
  return map;
})();

/**
 * Validates that `colorMap` is exactly 256 × 4 = 1024 bytes.
 * Throws with a descriptive message if not.
 */
export function validateColorMap(colorMap: Uint8Array): void {
  if (colorMap.length !== 1024) {
    throw new Error(
      `HealpixCellsLayer: colorMap must be exactly 256 × 4 = 1024 bytes, got ${colorMap.length}`
    );
  }
}
