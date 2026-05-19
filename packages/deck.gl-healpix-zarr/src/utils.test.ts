import {
  clampToAvailable,
  getNsideForZoom,
  rowRangeFromOffsetPair
} from './utils.js';

describe('clampToAvailable', () => {
  const available = [1, 4, 16, 64, 256];

  it('returns the exact value if it is available', () => {
    expect(clampToAvailable(16, available)).toBe(16);
  });

  it('clamps to the highest available nside when target exceeds max', () => {
    expect(clampToAvailable(1024, available)).toBe(256);
  });

  it('clamps to the lowest available nside when target is below min', () => {
    expect(clampToAvailable(0, available)).toBe(1);
  });

  it('picks the nearest available nside (rounds up to next available)', () => {
    // 8 is between 4 and 16; nearest is 4 if we go to the closest
    // clamp picks the largest available that is <= target, or min if none
    expect(clampToAvailable(8, available)).toBe(4);
  });

  it('picks the exact match when target equals an available value', () => {
    expect(clampToAvailable(64, available)).toBe(64);
  });
});

describe('getNsideForZoom', () => {
  const available = [1, 4, 16, 64, 256];

  it('returns nside = 2^round(zoom + zoomOffset) clamped to available', () => {
    // zoom=0, zoomOffset=0 => 2^0 = 1
    expect(getNsideForZoom(0, 0, available)).toBe(1);
  });

  it('uses zoomOffset to shift nside selection', () => {
    // zoom=0, zoomOffset=2 => 2^2 = 4
    expect(getNsideForZoom(0, 2, available)).toBe(4);
  });

  it('clamps to max available when formula exceeds max', () => {
    expect(getNsideForZoom(10, 5, available)).toBe(256);
  });

  it('clamps to min available when formula is below min', () => {
    expect(getNsideForZoom(-10, 0, available)).toBe(1);
  });

  it('rounds zoom fractional values', () => {
    // zoom=1.5, zoomOffset=0 => 2^round(1.5) = 2^2 = 4
    expect(getNsideForZoom(1.5, 0, available)).toBe(4);
  });
});

describe('rowRangeFromOffsetPair', () => {
  it('returns rowStart and rowEnd for a valid pair of numbers', () => {
    expect(rowRangeFromOffsetPair([10, 20])).toEqual({
      rowStart: 10,
      rowEnd: 20
    });
  });

  it('returns rowStart and rowEnd for a valid pair of bigints', () => {
    expect(rowRangeFromOffsetPair([10n, 20n])).toEqual({
      rowStart: 10,
      rowEnd: 20
    });
  });

  it('returns null when rowStart >= rowEnd (empty tile)', () => {
    expect(rowRangeFromOffsetPair([5, 5])).toBeNull();
    expect(rowRangeFromOffsetPair([6, 5])).toBeNull();
  });

  it('returns null when pair has fewer than 2 elements', () => {
    expect(rowRangeFromOffsetPair([5])).toBeNull();
    expect(rowRangeFromOffsetPair([])).toBeNull();
  });

  it('handles large bigint values safely', () => {
    const result = rowRangeFromOffsetPair([BigInt(0), BigInt(2 ** 31 + 5)]);
    expect(result?.rowEnd).toBe(2 ** 31 + 5);
  });
});
