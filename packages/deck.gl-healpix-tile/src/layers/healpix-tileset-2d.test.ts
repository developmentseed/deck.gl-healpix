import { describe, it, expect } from '@jest/globals';
import { pix2LonLatNest } from 'healpix-ts';
import { HealpixTileset2D, computePerTileLOD } from './healpix-tileset-2d';
import {
  lonLatDistanceSq,
  sortTileIndicesByViewportCenter
} from '../lib/sort-by-distance';

type GetTileIndicesArgs = Parameters<HealpixTileset2D['getTileIndices']>[0];

// Minimal Viewport mock — provides only what HealpixTileset2D.getTileIndices needs.
function makeViewport(
  zoom: number,
  bounds: [number, number, number, number]
): GetTileIndicesArgs['viewport'] {
  return {
    zoom,
    getBounds: () => bounds
  };
}

const GLOBAL_BOUNDS: [number, number, number, number] = [-180, -90, 180, 90];

describe('sortTileIndicesByViewportCenter', () => {
  it('accepts (indices, viewport) without a partitionNside argument', () => {
    const tiles = [
      { x: 3, y: 1, z: 5 },
      { x: 0, y: 0, z: 2 }
    ];
    const viewport = {
      longitude: 0,
      latitude: 0,
      getBounds: (): [number, number, number, number] => [-180, -90, 180, 90]
    };
    const sorted = sortTileIndicesByViewportCenter(tiles, viewport);
    expect(sorted).toHaveLength(2);
    const ids = sorted.map((t) => `${t.z}-${t.y}-${t.x}`);
    expect(ids).toContain('5-1-3');
    expect(ids).toContain('2-0-0');
  });
});

// ── computePerTileLOD ────────────────────────────────────────────────────────
//
// Test parameters used throughout:
//   zoom=5, baseNside=128, basePartitionNside=2, parentLevels=6
//   availableNsides=[4, 16, 32, 64, 128]
//
// Reference width for these parameters:
//   cellAngularSize = 57.3 / 2 = 28.65 degrees
//   degreesPerPixel = 360 / (512 * 2^5) = 360 / 16384 ≈ 0.021973
//   refW = 28.65 / 0.021973 ≈ 1304 pixels

function makeProjectMock(
  ...results: [number, number][]
): (xy: number[]) => number[] {
  let call = 0;
  return () => results[call++ % results.length] as number[];
}

describe('computePerTileLOD', () => {
  const ZOOM = 5;
  const BASE_NSIDE = 128;
  const BASE_PARTITION_NSIDE = 2;
  const PARENT_LEVELS = 6;
  const AVAILABLE = [4, 16, 32, 64, 128];
  const XBASE = 0;

  it('falls back to base nside when viewport.project is absent', () => {
    const viewport = { zoom: ZOOM };
    const tile = computePerTileLOD(
      XBASE,
      BASE_PARTITION_NSIDE,
      BASE_NSIDE,
      PARENT_LEVELS,
      viewport,
      AVAILABLE
    );
    // baseNside=128 → z=7; basePartitionNside=2 → y=1; x unchanged
    expect(tile).toEqual({ x: 0, y: 1, z: 7 });
  });

  it('returns base nside for a tile in the bottom portion of the screen (high normalizedY)', () => {
    // sy1=90, height=100 → normalizedY=0.9 → band [1.0, 1.0] → fraction=1.0 → ndata=128
    const viewport = {
      zoom: ZOOM,
      height: 100,
      pitch: 60,
      project: makeProjectMock([0, 90])
    };
    const tile = computePerTileLOD(
      XBASE,
      BASE_PARTITION_NSIDE,
      BASE_NSIDE,
      PARENT_LEVELS,
      viewport,
      AVAILABLE
    );
    expect(tile).toEqual({ x: 0, y: 1, z: 7 }); // nside=128 unchanged
  });

  it('steps down to a lower nside for a tile near the top of the screen (far tile)', () => {
    // sy1=10, height=200 → normalizedY=0.05 → band [0.2, 0.4] → fraction=0.4
    // targetNside=round(128*0.4)=51 → clamp to 32
    // partNside=max(1,32>>6)=1 → levelDiff=nside2order(2)-nside2order(1)=1
    // xd=floor(0/4)=0 → { x:0, y:0, z:5 }
    const viewport = {
      zoom: ZOOM,
      height: 200,
      pitch: 60,
      project: makeProjectMock([0, 10])
    };
    const tile = computePerTileLOD(
      XBASE,
      BASE_PARTITION_NSIDE,
      BASE_NSIDE,
      PARENT_LEVELS,
      viewport,
      AVAILABLE
    );
    expect(tile).toEqual({ x: 0, y: 0, z: 5 }); // nside=32
  });
});

describe('HealpixTileset2D.getTileId', () => {
  it('returns z-y-x string for a HealpixTileIndex', () => {
    const ts = new HealpixTileset2D({ availableNsides: [4] });
    expect(ts.getTileId({ x: 7, y: 0, z: 2 })).toBe('2-0-7');
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

  it('decrements y when parentLevels=0 and partition nside halves', () => {
    const ts = new HealpixTileset2D({
      availableNsides: [16],
      parentLevels: 0
    });
    expect(ts.getParentIndex({ x: 8, y: 4, z: 4 })).toEqual({
      x: 2,
      y: 3,
      z: 3
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
      nsideOffset: 0,
      parentLevels: 0
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport });
    expect(Array.isArray(indices)).toBe(true);
    for (const idx of indices) {
      expect(typeof idx.x).toBe('number');
      expect(idx.y).toBe(idx.z);
      expect(typeof idx.z).toBe('number');
    }
  });

  it('with parentLevels=0, queries at data nside (192 tiles for nside=4 globally)', () => {
    // parentLevels=0 => nsideParent = nside = 4 => 12*16 = 192 tiles
    const ts = new HealpixTileset2D({
      availableNsides: [4],
      nsideOffset: 0,
      parentLevels: 0
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport });
    expect(indices.length).toBe(192);
  });

  it('with parentLevels=2, queries at nside/4 (48 tiles for nside=4 globally)', () => {
    // nside=4, parentLevels=2 => nsideParent = 4>>2 = 1 => 12*1 = 12 tiles
    // Actually 4>>2 = 1, so nsideParent=1 => 12*1 = 12 tiles
    const ts = new HealpixTileset2D({
      availableNsides: [4],
      nsideOffset: 0,
      parentLevels: 2
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport });
    expect(indices.length).toBe(12);
  });

  it('with parentLevels=1, queries at nside/2 (48 tiles for nside=4 globally)', () => {
    // nside=4, parentLevels=1 => nsideParent = 4>>1 = 2 => 12*4 = 48 tiles
    const ts = new HealpixTileset2D({
      availableNsides: [4],
      nsideOffset: 0,
      parentLevels: 1
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport });
    expect(indices.length).toBe(48);
  });

  it('with parentLevels=6 (default), clamps nsideParent to 1 for low nsides', () => {
    // nside=4, parentLevels=6 => 4>>6 = 0, clamped to 1 => 12 tiles
    const ts = new HealpixTileset2D({
      availableNsides: [4],
      nsideOffset: 0,
      parentLevels: 6
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport });
    expect(indices.length).toBe(12);
  });

  it('with parentLevels=6 and nside=256, nsideParent=4 (192 tiles globally)', () => {
    // nside=256, parentLevels=6 => nsideParent = 256>>6 = 4 => 12*16 = 192 tiles
    const ts = new HealpixTileset2D({
      availableNsides: [256],
      nsideOffset: 0,
      parentLevels: 6
    });
    const viewport = makeViewport(8, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport });
    expect(indices.length).toBe(192);
  });

  it('returns empty array when availableNsides is empty', () => {
    const ts = new HealpixTileset2D({ availableNsides: [] });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport });
    expect(indices).toHaveLength(0);
  });

  it('reflects updated availableNsides after setOptions', () => {
    // Start with no available nsides (simulates layer before metadata loads).
    const ts = new HealpixTileset2D({
      availableNsides: [],
      nsideOffset: 0,
      parentLevels: 0
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    expect(ts.getTileIndices({ viewport })).toHaveLength(0);

    ts.setOptions({ availableNsides: [4] });
    // nside=4, parentLevels=0 => nsideParent=4 => 12*16=192 tiles globally
    expect(ts.getTileIndices({ viewport })).toHaveLength(192);
  });

  it('reflects updated parentLevels after setOptions', () => {
    const ts = new HealpixTileset2D({
      availableNsides: [4],
      nsideOffset: 0,
      parentLevels: 0
    });
    const viewport = makeViewport(2, GLOBAL_BOUNDS);
    expect(ts.getTileIndices({ viewport })).toHaveLength(192); // parentLevels=0 => 192 tiles

    ts.setOptions({ parentLevels: 2 });
    // parentLevels=2 => nsideParent = 4>>2 = 1 => 12 tiles
    expect(ts.getTileIndices({ viewport })).toHaveLength(12);
  });

  it('z value in returned indices equals log2(data nside), not log2(nsideParent)', () => {
    // nside=256, parentLevels=6 => nsideParent=4, but z should encode data nside=256 => z=8
    const ts = new HealpixTileset2D({
      availableNsides: [256],
      nsideOffset: 0,
      parentLevels: 6
    });
    const viewport = makeViewport(8, GLOBAL_BOUNDS);
    const indices = ts.getTileIndices({ viewport });
    expect(indices.every((i) => i.z === 8)).toBe(true); // log2(256)=8
  });

  it('sorts tiles by increasing distance from viewport center', () => {
    const ts = new HealpixTileset2D({
      availableNsides: [4],
      nsideOffset: 0,
      parentLevels: 0
    });
    const centerLon = -74;
    const centerLat = 40.7;
    const bbox: [number, number, number, number] = [
      centerLon - 0.2,
      centerLat - 0.15,
      centerLon + 0.2,
      centerLat + 0.15
    ];
    const viewport = {
      zoom: 2,
      longitude: centerLon,
      latitude: centerLat,
      getBounds: () => bbox
    };
    const indices = ts.getTileIndices({ viewport });
    expect(indices.length).toBeGreaterThan(1);

    const partitionNside = 4;
    let prevDist = -1;
    for (const { x } of indices) {
      const [lon, lat] = pix2LonLatNest(partitionNside, x);
      const dist = lonLatDistanceSq(lon, lat, centerLon, centerLat);
      expect(dist).toBeGreaterThanOrEqual(prevDist);
      prevDist = dist;
    }
  });

  it('sorting does not change which tiles are selected', () => {
    const ts = new HealpixTileset2D({
      availableNsides: [4],
      nsideOffset: 0,
      parentLevels: 0
    });
    const bbox: [number, number, number, number] = [-10, 40, 10, 55];
    const viewportA = { zoom: 2, getBounds: () => bbox };
    const viewportB = {
      zoom: 2,
      longitude: 0,
      latitude: 47.5,
      getBounds: () => bbox
    };
    const idsA = ts
      .getTileIndices({ viewport: viewportA })
      .map((i) => `${i.z}-${i.y}-${i.x}`)
      .sort();
    const idsB = ts
      .getTileIndices({ viewport: viewportB })
      .map((i) => `${i.z}-${i.y}-${i.x}`)
      .sort();
    expect(idsB).toEqual(idsA);
    expect(idsA.length).toBeGreaterThan(1);
  });

  it('uses nsideOffset to shift data nside selection', () => {
    // Both use parentLevels=0 so nsideParent=nside, making tile counts directly comparable
    const ts4 = new HealpixTileset2D({
      availableNsides: [4, 16],
      nsideOffset: 2,
      parentLevels: 0
    });
    const ts16 = new HealpixTileset2D({
      availableNsides: [4, 16],
      nsideOffset: 4,
      parentLevels: 0
    });
    const viewport = makeViewport(0, GLOBAL_BOUNDS);
    const i4 = ts4.getTileIndices({ viewport });
    const i16 = ts16.getTileIndices({ viewport });
    // nside=16 has (16/4)^2 = 16x more cells than nside=4
    expect(i16.length).toBe(i4.length * 16);
  });

  it('returns base nside tiles unchanged when viewport.project is absent (backward-compat)', () => {
    // This is the current behaviour — existing flat viewports must be unaffected.
    const ts = new HealpixTileset2D({
      availableNsides: [4, 128],
      nsideOffset: 0,
      parentLevels: 6
    });
    // zoom=7 → baseNside=128 → basePartitionNside=max(1,128>>6)=2 → 12*4=48 tiles
    const viewport = makeViewport(7, GLOBAL_BOUNDS);
    const tiles = ts.getTileIndices({ viewport });
    expect(tiles).toHaveLength(48);
    expect(tiles.every((t) => t.z === 7)).toBe(true); // nside2order(128)=7
  });

  it('reduces nside and deduplicates when all tiles are near the top of screen (tilted viewport)', () => {
    // availableNsides=[4,128], parentLevels=6, nsideOffset=0
    // zoom=7 → baseNside=128, basePartitionNside=2 → 48 candidate cells globally
    // All project sy1=10, height=200 → normalizedY=0.05 → band [0.2, 0.4] → fraction=0.4
    // targetNside=round(128*0.4)=51 → clamp to 4 (only [4,128] available)
    // partNside=max(1,4>>6)=1, levelDiff=nside2order(2)-nside2order(1)=1
    // xd=floor(x/4) for x∈[0,47] → xd∈[0,11] → 12 unique tiles at z=2
    const ts = new HealpixTileset2D({
      availableNsides: [4, 128],
      nsideOffset: 0,
      parentLevels: 6
    });
    const viewport = {
      zoom: 7,
      height: 200,
      pitch: 60,
      getBounds: () => GLOBAL_BOUNDS,
      project: (_xy: number[]) => [0, 10] as [number, number]
    };
    const tiles = ts.getTileIndices({ viewport });
    expect(tiles).toHaveLength(12);
    expect(tiles.every((t) => t.z === 2)).toBe(true); // nside2order(4)=2
    // Verify no duplicate tile IDs
    const ids = tiles.map((t) => `${t.z}-${t.y}-${t.x}`);
    expect(new Set(ids).size).toBe(12);
  });
});
