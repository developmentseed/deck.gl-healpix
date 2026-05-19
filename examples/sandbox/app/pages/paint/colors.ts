/** Paint palette swatches (hex). */
export const PAINT_COLORS = [
  '#264653',
  '#2a9d8f',
  '#e9c46a',
  '#f4a261',
  '#e76f51'
] as const;

export type PaintColorIndex = 0 | 1 | 2 | 3 | 4;

export const DEFAULT_COLOR_INDEX: PaintColorIndex = 0;

const HEX_RE = /^#?([0-9a-f]{6})$/i;

/** Parse #RRGGBB to 0–1 RGB channels. */
export function hexToRgb(hex: string): [number, number, number] {
  const match = HEX_RE.exec(hex.trim());
  if (!match) return [0, 0, 0];
  const n = Number.parseInt(match[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function hexToRgba(
  hex: string,
  alpha = 0.65
): [number, number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [r, g, b, alpha];
}

export function paintColorRgba(
  colorIndex: PaintColorIndex
): [number, number, number, number] {
  return hexToRgba(PAINT_COLORS[colorIndex]);
}
