import { makeColorMap } from '@developmentseed/deck.gl-healpix';

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

/** Cell fill opacity baked into the colorMap LUT. */
const PAINT_FILL_ALPHA = 200;
const HEX_RE = /^#?([0-9a-f]{6})$/i;

/** Parse #RRGGBB to 0–1 RGB channels. */
export function hexToRgb(hex: string): [number, number, number] {
  const match = HEX_RE.exec(hex.trim());
  if (!match) return [0, 0, 0];
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** LUT for scalar cell values (color indices 0…n−1). */
export const PAINT_COLOR_MAP = makeColorMap((t) => {
  const i = t * 255;
  const v = PAINT_COLORS[i];
  return v ? [...hexToRgb(v), PAINT_FILL_ALPHA] : [0, 0, 0, PAINT_FILL_ALPHA];
});
