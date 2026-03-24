import {
  makeColorFrameFromValues,
  normalizeColorFrameValue,
  parseHexColorToRgba255
} from './color-frame';

describe('parseHexColorToRgba255', () => {
  it('parses #RGB and #RGBA shorthand', () => {
    expect(parseHexColorToRgba255('#f00')).toEqual([255, 0, 0, 255]);
    expect(parseHexColorToRgba255('#f008')).toEqual([255, 0, 0, 136]);
  });

  it('parses #RRGGBB and #RRGGBBAA', () => {
    expect(parseHexColorToRgba255('#ff0000')).toEqual([255, 0, 0, 255]);
    expect(parseHexColorToRgba255('#ff000080')).toEqual([255, 0, 0, 128]);
  });
});

describe('normalizeColorFrameValue', () => {
  it('accepts uint8 tuples', () => {
    expect(normalizeColorFrameValue([10, 20, 30])).toEqual([10, 20, 30, 255]);
    expect(normalizeColorFrameValue([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it('accepts normalized object form', () => {
    expect(
      normalizeColorFrameValue({ normalized: true, rgba: [1, 0.5, 0, 1] })
    ).toEqual([255, 128, 0, 255]);
    expect(
      normalizeColorFrameValue({ normalized: true, rgba: [0, 0, 0] })
    ).toEqual([0, 0, 0, 255]);
  });

  it('clamps out-of-range uint8 and unit values', () => {
    expect(normalizeColorFrameValue([-1, 300, 128])).toEqual([
      0, 255, 128, 255
    ]);
    expect(
      normalizeColorFrameValue({ normalized: true, rgba: [-1, 2, 0.5] })
    ).toEqual([0, 255, 128, 255]);
  });
});

describe('makeColorFrameFromValues', () => {
  it('fills RGBA per cell from callback', () => {
    const frame = makeColorFrameFromValues([0, 1], (value) =>
      value === 0 ? '#f00' : { normalized: true, rgba: [0, 1, 0] }
    );
    expect(Array.from(frame)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });
});
