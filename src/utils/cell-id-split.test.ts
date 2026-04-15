import { splitCellIds } from './cell-id-split';

describe('splitCellIds', () => {
  it('splits small ids (Uint32Array) — hi is always zero', () => {
    const ids = new Uint32Array([0, 1, 4294967295]);
    const { lo, hi } = splitCellIds(ids);
    expect(lo).toEqual(new Uint32Array([0, 1, 4294967295]));
    expect(hi).toEqual(new Uint32Array([0, 0, 0]));
  });

  it('splits large ids (Float64Array) with values > 2^32', () => {
    // nside=262144 max cellId = 12 * 262144^2 - 1 = 824633720831
    // 824633720831 = 0x_0000_00BF_FFFF_FFFF
    // hi = 0xBF = 191, lo = 0xFFFFFFFF = 4294967295
    const id = 824633720831; // 0xBFFFFFFFFF
    const ids = new Float64Array([id]);
    const { lo, hi } = splitCellIds(ids);
    expect(lo[0]).toBe(0xFFFFFFFF);
    expect(hi[0]).toBe(0xBF);
  });

  it('splits a known cell id from nside=262144 correctly', () => {
    // cell 1 in face 0: raw value = 1
    const ids = new Float64Array([1, 2 ** 32, 2 ** 32 + 1]);
    const { lo, hi } = splitCellIds(ids);
    expect(lo[0]).toBe(1);    expect(hi[0]).toBe(0);
    expect(lo[1]).toBe(0);    expect(hi[1]).toBe(1);
    expect(lo[2]).toBe(1);    expect(hi[2]).toBe(1);
  });
});
