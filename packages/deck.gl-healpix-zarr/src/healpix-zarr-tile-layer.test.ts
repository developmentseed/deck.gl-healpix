import { describe, it, expect } from '@jest/globals';
import { assembleTileData, loadTileFromGroup } from './zarr-pyramid';

describe('assembleTileData', () => {
  it('returns null when offset pair indicates an empty tile', () => {
    const result = assembleTileData(
      4,
      [5n, 5n],
      new Float64Array(0),
      [new Float32Array(0)],
      ['red']
    );
    expect(result).toBeNull();
  });

  it('returns HealpixZarrTileData for a single-band tile', () => {
    const result = assembleTileData(
      4,
      [0n, 3n],
      new Float64Array([10, 11, 12]),
      [new Float32Array([0.1, 0.2, 0.3])],
      ['red']
    );

    expect(result).not.toBeNull();
    expect(result!.nside).toBe(4);
    expect(result!.bands).toEqual(['red']);
    expect(result!.cellIds.length).toBe(3);
    expect(result!.values[0]).toBeCloseTo(0.1, 5);
    expect(result!.values[1]).toBeCloseTo(0.2, 5);
    expect(result!.values[2]).toBeCloseTo(0.3, 5);
  });

  it('interleaves two bands correctly: [b0_p0, b1_p0, b0_p1, b1_p1, b0_p2, b1_p2]', () => {
    const result = assembleTileData(
      8,
      [0n, 3n],
      new Float64Array([1, 2, 3]),
      [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])],
      ['r', 'g']
    );

    expect(result).not.toBeNull();
    expect(result!.bands).toEqual(['r', 'g']);
    expect(Array.from(result!.values)).toEqual([1, 4, 2, 5, 3, 6]);
  });

  it('returns null when cell id slice is empty despite valid offsets', () => {
    const result = assembleTileData(
      4,
      [0n, 3n],
      new Float64Array(0),
      [new Float32Array([1, 2, 3])],
      ['red']
    );
    expect(result).toBeNull();
  });
});

describe('loadTileFromGroup', () => {
  it('returns null when selectedBands is empty', async () => {
    const result = await loadTileFromGroup(
      { nside: 4 } as Parameters<typeof loadTileFromGroup>[0],
      0,
      []
    );
    expect(result).toBeNull();
  });

  it('returns null when AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await loadTileFromGroup(
      { nside: 4 } as Parameters<typeof loadTileFromGroup>[0],
      0,
      ['red'],
      controller.signal
    );
    expect(result).toBeNull();
  });
});
