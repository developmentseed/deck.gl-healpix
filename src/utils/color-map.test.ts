import { DEFAULT_COLORMAP, validateColorMap } from './color-map';

describe('DEFAULT_COLORMAP', () => {
  it('is exactly 1024 bytes (256 × 4)', () => {
    expect(DEFAULT_COLORMAP.length).toBe(1024);
  });

  it('starts with black (0,0,0,255)', () => {
    expect(DEFAULT_COLORMAP[0]).toBe(0);
    expect(DEFAULT_COLORMAP[1]).toBe(0);
    expect(DEFAULT_COLORMAP[2]).toBe(0);
    expect(DEFAULT_COLORMAP[3]).toBe(255);
  });

  it('ends with white (255,255,255,255)', () => {
    expect(DEFAULT_COLORMAP[1020]).toBe(255);
    expect(DEFAULT_COLORMAP[1021]).toBe(255);
    expect(DEFAULT_COLORMAP[1022]).toBe(255);
    expect(DEFAULT_COLORMAP[1023]).toBe(255);
  });

  it('has a linear gray gradient', () => {
    expect(DEFAULT_COLORMAP[128 * 4 + 0]).toBe(128);
    expect(DEFAULT_COLORMAP[128 * 4 + 1]).toBe(128);
    expect(DEFAULT_COLORMAP[128 * 4 + 2]).toBe(128);
    expect(DEFAULT_COLORMAP[128 * 4 + 3]).toBe(255);
  });
});

describe('validateColorMap', () => {
  it('does not throw for exactly 1024 bytes', () => {
    expect(() => validateColorMap(new Uint8Array(1024))).not.toThrow();
  });

  it('throws for wrong length with a message mentioning 1024', () => {
    expect(() => validateColorMap(new Uint8Array(100))).toThrow('1024');
    expect(() => validateColorMap(new Uint8Array(0))).toThrow('1024');
    expect(() => validateColorMap(new Uint8Array(1025))).toThrow('1024');
  });
});
