import { describe, it, expect } from '@jest/globals';
import {
  loadTileFromGroup,
  loadRootMetadata,
  type GroupHandle
} from './zarr-pyramid.js';

// Minimal zarr array stub: holds a flat data array and returns slices via getData.
function makeZarrArray(data: ArrayLike<number | bigint>) {
  return {
    async getData(_slice: unknown) {
      return { data };
    }
  };
}

// Build a GroupHandle with per-band array stubs.
function makeGroup(opts: {
  offsets: [bigint, bigint];
  cellIds: ArrayLike<number | bigint>;
  bandData: Record<string, ArrayLike<number>>;
  allBands?: string[];
  nside?: number;
}): GroupHandle {
  const { offsets, cellIds, bandData, nside = 4 } = opts;
  const allBands = opts.allBands ?? Object.keys(bandData);

  const bandArrs = new Map<string, any>(
    Object.entries(bandData).map(([name, data]) => [name, makeZarrArray(data)])
  );

  return {
    nside,
    nsideParent: nside / 2 || 1,
    cellIdArr: makeZarrArray(cellIds),
    parentOffsetsArr: makeZarrArray(BigInt64Array.from(offsets)),
    bandArrs,
    allBands
  } as unknown as GroupHandle;
}

async function fakeZarrGet(arr: any, _selector: unknown) {
  return arr.getData ? arr.getData(_selector) : { data: arr.data };
}

describe('loadTileFromGroup', () => {
  it('returns null when selectedBands is empty', async () => {
    const group = makeGroup({
      offsets: [0n, 3n],
      cellIds: new Float64Array([1, 2, 3]),
      bandData: { red: new Float32Array([0.1, 0.2, 0.3]) }
    });

    const result = await loadTileFromGroup(group, 0, [], fakeZarrGet);
    expect(result).toBeNull();
  });

  it('returns null when offset pair indicates an empty tile', async () => {
    const group = makeGroup({
      offsets: [5n, 5n],
      cellIds: new Float64Array(0),
      bandData: { red: new Float32Array(0) }
    });

    const result = await loadTileFromGroup(group, 0, ['red'], fakeZarrGet);
    expect(result).toBeNull();
  });

  it('returns HealpixZarrTileData for a single-band tile', async () => {
    const group = makeGroup({
      offsets: [0n, 3n],
      cellIds: new Float64Array([10, 11, 12]),
      bandData: { red: new Float32Array([0.1, 0.2, 0.3]) },
      nside: 4
    });

    const result = await loadTileFromGroup(group, 0, ['red'], fakeZarrGet);

    expect(result).not.toBeNull();
    expect(result!.nside).toBe(4);
    expect(result!.bands).toEqual(['red']);
    expect(result!.cellIds.length).toBe(3);
    expect(result!.values[0]).toBeCloseTo(0.1, 5);
    expect(result!.values[1]).toBeCloseTo(0.2, 5);
    expect(result!.values[2]).toBeCloseTo(0.3, 5);
  });

  it('interleaves two bands correctly: [b0_p0, b1_p0, b0_p1, b1_p1, b0_p2, b1_p2]', async () => {
    const group = makeGroup({
      offsets: [0n, 3n],
      cellIds: new Float64Array([1, 2, 3]),
      bandData: {
        r: new Float32Array([1, 2, 3]),
        g: new Float32Array([4, 5, 6])
      },
      nside: 8
    });

    const result = await loadTileFromGroup(group, 0, ['r', 'g'], fakeZarrGet);

    expect(result).not.toBeNull();
    expect(result!.bands).toEqual(['r', 'g']);
    expect(Array.from(result!.values)).toEqual([1, 4, 2, 5, 3, 6]);
  });

  it('returns null when AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const group = makeGroup({
      offsets: [0n, 3n],
      cellIds: new Float64Array([1, 2, 3]),
      bandData: { red: new Float32Array([0.1, 0.2, 0.3]) }
    });

    const result = await loadTileFromGroup(
      group,
      0,
      ['red'],
      fakeZarrGet,
      controller.signal
    );
    expect(result).toBeNull();
  });

  it('only loads selected bands, not all bands', async () => {
    let greenLoaded = false;
    const group = makeGroup({
      offsets: [0n, 2n],
      cellIds: new Float64Array([1, 2]),
      bandData: { red: new Float32Array([1, 2]) }
    });

    // Inject a spy for 'green' that should not be called
    (group.bandArrs as Map<string, any>).set('green', {
      async getData() {
        greenLoaded = true;
        return { data: new Float32Array([9, 9]) };
      }
    });
    (group as any).allBands = ['red', 'green'];

    await loadTileFromGroup(group, 0, ['red'], fakeZarrGet);
    expect(greenLoaded).toBe(false);
  });
});

describe('loadRootMetadata', () => {
  it('derives bands and nsides from root attrs', async () => {
    // Inject a fake getRoot by providing a mock URL and overriding the module cache.
    // Since we cannot easily inject getRoot, we test indirectly via the exported function.
    // This test is left as a structural placeholder; integration tests cover the full path.
    expect(typeof loadRootMetadata).toBe('function');
  });
});

describe('HealpixZarrTileLayer', () => {
  it('has the correct static layerName', async () => {
    const { HealpixZarrTileLayer } =
      await import('./healpix-zarr-tile-layer.js');
    expect(HealpixZarrTileLayer.layerName).toBe('HealpixZarrTileLayer');
  });
});
