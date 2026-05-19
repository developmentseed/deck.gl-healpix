import { describe, it, expect } from '@jest/globals';
import { HealpixTileset2D } from './healpix-tileset-2d.js';

// Minimal Viewport mock — provides only what HealpixTileset2D.getTileIndices needs.
function makeViewport(zoom: number, bounds: [number, number, number, number]) {
  return {
    zoom,
    getBounds: () => bounds
  };
}

const GLOBAL_BOUNDS: [number, number, number, number] = [-180, -90, 180, 90];

describe('HealpixTileset2D.getTileId', () => {
  it('returns z-x string for a HealpixTileIndex', () => {
    const ts = new HealpixTileset2D({ availableNsides: [4] });
    expect(ts.getTileId({ x: 7, y: 0, z: 2 })).toBe('2-7');
  });
});

describe('HealpixTileset2D.getTileZoom', () => {
  it('returns z from index', () => {
    const ts = new HealpixTileset2D({ availableNsides: [4] });
    expect(ts.getTileZoom({ x: 0, y: 0, z: 3 })).toBe(3);
  });
});

describe('HealpixTileset2D.getParentIndex', () => {
  it('returns parent by dividing x by 4 and decrementing z', () => {
    const ts = new HealpixTileset2D({ availableNsides: [4, 16] });
    expect(ts.getParentIndex({ x: 8, y: 0, z: 4 })).toEqual({
      x: 2,
      y: 0,
      z: 3
    });
  });

  it('floors fractional x/4 correctly', () => {
    const ts = new HealpixTileset2D({ availableNsides: [4] });
    expect(ts.getParentIndex({ x: 7, y: 0, z: 2 })).toEqual({
      x: 1,
      y: 0,
      z: 1
    });
  });

  it('is safe for large cell indices beyond 2^31', () => {
    const ts = new HealpixTileset2D({ availableNsides: [4] });
    const largeX = 2 ** 32 + 8;
    const parent = ts.getParentIndex({ x: largeX, y: 0, z: 20 });
    expect(parent.x).toBe(Math.floor(largeX / 4));
  });
});

describe('HealpixTileset2D.getTileIndices — parentLevels', () => {
  it('returns an array of HealpixTileIndex objects', () => {
    const ts = new HealpixTileset2D({
      availableNsides: [4],
      zoomOffset: 0,
      parentLevels: 0
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport } as any);
    expect(Array.isArray(indices)).toBe(true);
    for (const idx of indices) {
      expect(typeof idx.x).toBe('number');
      expect(idx.y).toBe(0);
      expect(typeof idx.z).toBe('number');
    }
  });

  it('with parentLevels=0, queries at data nside (192 tiles for nside=4 globally)', () => {
    // parentLevels=0 => nsideParent = nside = 4 => 12*16 = 192 tiles
    const ts = new HealpixTileset2D({
      availableNsides: [4],
      zoomOffset: 0,
      parentLevels: 0
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport } as any);
    expect(indices.length).toBe(192);
  });

  it('with parentLevels=2, queries at nside/4 (48 tiles for nside=4 globally)', () => {
    // nside=4, parentLevels=2 => nsideParent = 4>>2 = 1 => 12 tiles
    // Actually 4>>2 = 1, so nsideParent=1 => 12*1 = 12 tiles
    const ts = new HealpixTileset2D({
      availableNsides: [4],
      zoomOffset: 0,
      parentLevels: 2
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport } as any);
    expect(indices.length).toBe(12);
  });

  it('with parentLevels=1, queries at nside/2 (48 tiles for nside=4 globally)', () => {
    // nside=4, parentLevels=1 => nsideParent = 4>>1 = 2 => 12*4 = 48 tiles
    const ts = new HealpixTileset2D({
      availableNsides: [4],
      zoomOffset: 0,
      parentLevels: 1
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport } as any);
    expect(indices.length).toBe(48);
  });

  it('with parentLevels=6 (default), clamps nsideParent to 1 for low nsides', () => {
    // nside=4, parentLevels=6 => 4>>6 = 0, clamped to 1 => 12 tiles
    const ts = new HealpixTileset2D({
      availableNsides: [4],
      zoomOffset: 0,
      parentLevels: 6
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport } as any);
    expect(indices.length).toBe(12);
  });

  it('with parentLevels=6 and nside=256, nsideParent=4 (192 tiles globally)', () => {
    // nside=256, parentLevels=6 => nsideParent = 256>>6 = 4 => 12*16 = 192 tiles
    const ts = new HealpixTileset2D({
      availableNsides: [256],
      zoomOffset: 0,
      parentLevels: 6
    });
    const viewport = makeViewport(8, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport } as any);
    expect(indices.length).toBe(192);
  });

  it('returns empty array when availableNsides is empty', () => {
    const ts = new HealpixTileset2D({ availableNsides: [] });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport } as any);
    expect(indices).toHaveLength(0);
  });

  it('reflects updated availableNsides after setOptions', () => {
    // Start with no available nsides (simulates layer before metadata loads).
    const ts = new HealpixTileset2D({
      availableNsides: [],
      zoomOffset: 0,
      parentLevels: 0
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    expect(ts.getTileIndices({ viewport } as any)).toHaveLength(0);

    ts.setOptions({ availableNsides: [4] } as any);
    // nside=4, parentLevels=0 => nsideParent=4 => 12*16=192 tiles globally
    expect(ts.getTileIndices({ viewport } as any)).toHaveLength(192);
  });

  it('reflects updated parentLevels after setOptions', () => {
    const ts = new HealpixTileset2D({
      availableNsides: [4],
      zoomOffset: 0,
      parentLevels: 0
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    expect(ts.getTileIndices({ viewport } as any)).toHaveLength(192); // parentLevels=0 => 192 tiles

    ts.setOptions({ parentLevels: 2 } as any);
    // parentLevels=2 => nsideParent = 4>>2 = 1 => 12 tiles
    expect(ts.getTileIndices({ viewport } as any)).toHaveLength(12);
  });

  it('z value in returned indices equals log2(data nside), not log2(nsideParent)', () => {
    // nside=256, parentLevels=6 => nsideParent=4, but z should encode data nside=256 => z=8
    const ts = new HealpixTileset2D({
      availableNsides: [256],
      zoomOffset: 0,
      parentLevels: 6
    });
    const viewport = makeViewport(8, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport } as any);
    expect(indices.every((i) => i.z === 8)).toBe(true); // log2(256)=8
  });

  it('uses zoomOffset to shift data nside selection', () => {
    // Both use parentLevels=0 so nsideParent=nside, making tile counts directly comparable
    const ts4 = new HealpixTileset2D({
      availableNsides: [4, 16],
      zoomOffset: 2,
      parentLevels: 0
    });
    const ts16 = new HealpixTileset2D({
      availableNsides: [4, 16],
      zoomOffset: 4,
      parentLevels: 0
    });
    const viewport = makeViewport(0, GLOBAL_BOUNDS);
    const i4 = ts4.getTileIndices({ viewport } as any);
    const i16 = ts16.getTileIndices({ viewport } as any);
    // nside=16 has (16/4)^2 = 16x more cells than nside=4
    expect(i16.length).toBe(i4.length * 16);
  });
});
