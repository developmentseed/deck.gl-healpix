/**
 * Utilities to build per-cell RGBA color frames (Uint8Array, 0–255) from a callback.
 *
 * Callback results may be:
 * - A CSS-like hex string (`#RGB`, `#RRGGBB`, `#RRGGBBAA`)
 * - A 3- or 4-tuple of byte values (0–255)
 * - A normalized color: `{ normalized: true, rgba: [r,g,b] | [r,g,b,a] }` with channels in 0–1
 */

export type Uint8ColorArray =
  | readonly [number, number, number]
  | readonly [number, number, number, number];

export type NormalizedColorArray =
  | readonly [number, number, number]
  | readonly [number, number, number, number];

export type ColorFrameCallbackValue =
  | string
  | Uint8ColorArray
  | { readonly normalized: true; readonly rgba: NormalizedColorArray };

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clampUnit(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Parse a hex color string into RGBA bytes (0–255).
 * Supports `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA` (optional leading `#`).
 */
export function parseHexColorToRgba255(
  hex: string
): [number, number, number, number] {
  let s = hex.trim();
  if (s.startsWith('#')) s = s.slice(1);

  if (s.length === 3 || s.length === 4) {
    const expand = (i: number) =>
      parseInt(s.slice(i, i + 1) + s.slice(i, i + 1), 16);
    const r = expand(0);
    const g = expand(1);
    const b = expand(2);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      throw new Error(`Invalid hex color: ${hex}`);
    }
    if (s.length === 3) return [r, g, b, 255];
    const a = expand(3);
    if (Number.isNaN(a)) throw new Error(`Invalid hex color: ${hex}`);
    return [r, g, b, a];
  }

  if (s.length === 6 || s.length === 8) {
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      throw new Error(`Invalid hex color: ${hex}`);
    }
    if (s.length === 6) return [r, g, b, 255];
    const a = parseInt(s.slice(6, 8), 16);
    if (Number.isNaN(a)) throw new Error(`Invalid hex color: ${hex}`);
    return [r, g, b, a];
  }

  throw new Error(`Invalid hex color: ${hex}`);
}

/**
 * Normalize any supported callback color value to RGBA in 0–255.
 */
export function normalizeColorFrameValue(
  value: ColorFrameCallbackValue
): [number, number, number, number] {
  if (typeof value === 'string') {
    return parseHexColorToRgba255(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 3) {
      return [
        clampByte(value[0]),
        clampByte(value[1]),
        clampByte(value[2]),
        255
      ];
    }
    if (value.length === 4) {
      return [
        clampByte(value[0]),
        clampByte(value[1]),
        clampByte(value[2]),
        clampByte(value[3])
      ];
    }
    throw new Error(
      `Color array must have 3 or 4 channels; got length ${value.length}`
    );
  }

  if (
    value &&
    typeof value === 'object' &&
    'normalized' in value &&
    value.normalized === true
  ) {
    const c = value.rgba as readonly number[];
    const n = c.length;
    if (n === 3) {
      return [
        clampByte(clampUnit(c[0]) * 255),
        clampByte(clampUnit(c[1]) * 255),
        clampByte(clampUnit(c[2]) * 255),
        255
      ];
    }
    if (n === 4) {
      return [
        clampByte(clampUnit(c[0]) * 255),
        clampByte(clampUnit(c[1]) * 255),
        clampByte(clampUnit(c[2]) * 255),
        clampByte(clampUnit(c[3]) * 255)
      ];
    }
    throw new Error(
      `Normalized rgba must have 3 or 4 channels; got length ${n}`
    );
  }

  throw new Error('Invalid color frame value');
}

/**
 * Build one animation frame iterating over the values array.
 */
export function makeColorFrameFromValues<T>(
  values: T[],
  getColor: (value: T, index: number, all: T[]) => ColorFrameCallbackValue
): Uint8Array {
  const cellCount = values.length;
  const out = new Uint8Array(cellCount * 4);
  for (let i = 0; i < cellCount; i++) {
    const color = normalizeColorFrameValue(getColor(values[i], i, values));
    out.set(color, i * 4);
  }
  return out;
}
