# deck.gl-healpix-zarr Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `packages/deck.gl-healpix-zarr/` — a reusable deck.gl layer package that loads HEALPix parent-offset Zarr tile pyramids and renders them via `HealpixCellsLayer`.

**Architecture:** `HealpixTileset2D` subclasses deck.gl's `Tileset2D` to map viewport bounds → HEALPix parent cells; `HealpixZarrTileLayer` subclasses `TileLayer` (passing `TilesetClass: HealpixTileset2D`) to load per-tile zarr slices; `CachedZarrStore` provides chunk-level LRU caching and request deduplication beneath the tile cache. Color mapping is raw pass-through: values go directly to `HealpixCellsLayer`.

**Tech Stack:** TypeScript, deck.gl 9.3 (`@deck.gl/core`, `@deck.gl/geo-layers`), zarrita 0.6.x, healpix-ts, Jest + ts-jest, Rollup.

**Spec:** `docs/superpowers/specs/2026-04-27-deck-gl-healpix-zarr-design.md`

**Parallelisation note:** Tasks 3 and 4 are independent and can be executed in parallel.

---

## File Map

| File | Role |
|---|---|
| `packages/deck.gl-healpix-zarr/src/types.ts` | `HealpixTileIndex`, `HealpixZarrTileData` |
| `packages/deck.gl-healpix-zarr/src/utils.ts` | `clampToAvailable`, `getNsideForZoom`, `rowRangeFromOffsetPair` |
| `packages/deck.gl-healpix-zarr/src/cached-zarr-store.ts` | LRU chunk cache + request dedup (ported from healpix-explorer) |
| `packages/deck.gl-healpix-zarr/src/healpix-tileset-2d.ts` | `HealpixTileset2D extends Tileset2D` |
| `packages/deck.gl-healpix-zarr/src/healpix-zarr-tile-layer.ts` | `HealpixZarrTileLayer extends TileLayer` + `GroupHandle` + `loadTileFromGroup` |
| `packages/deck.gl-healpix-zarr/src/index.ts` | Public re-exports |
| `packages/deck.gl-healpix-zarr/src/utils.test.ts` | Unit tests for utils |
| `packages/deck.gl-healpix-zarr/src/cached-zarr-store.test.ts` | Unit tests for CachedZarrStore |
| `packages/deck.gl-healpix-zarr/src/healpix-tileset-2d.test.ts` | Unit tests for HealpixTileset2D |
| `packages/deck.gl-healpix-zarr/src/healpix-zarr-tile-layer.test.ts` | Unit tests for loadTileFromGroup |
| `packages/deck.gl-healpix-zarr/package.json` | Package manifest |
| `packages/deck.gl-healpix-zarr/tsconfig.json` | TS config |
| `packages/deck.gl-healpix-zarr/tsconfig.jest.json` | Jest-specific TS overrides |
| `packages/deck.gl-healpix-zarr/jest.config.ts` | Jest config |
| `packages/deck.gl-healpix-zarr/README.md` | Usage + API docs |
| `app/pages/zarr/zarr-tiles-parent-offsets.tsx` | **Modify** to import from new package |
| `app/pages/zarr/healpix-zarr-tile-layer-parent-offsets/` | **Delete** (replaced by package) |

---

## Task 1: Package scaffold

**Files:**
- Create: `packages/deck.gl-healpix-zarr/package.json`
- Create: `packages/deck.gl-healpix-zarr/tsconfig.json`
- Create: `packages/deck.gl-healpix-zarr/tsconfig.jest.json`
- Create: `packages/deck.gl-healpix-zarr/jest.config.ts`
- Create: `packages/deck.gl-healpix-zarr/src/index.ts` (stub)

- [ ] **Step 1: Create package directory and package.json**

```bash
mkdir -p /Users/daniel/guts/projects/healpix-layers-deck.gl/packages/deck.gl-healpix-zarr/src
```

`packages/deck.gl-healpix-zarr/package.json`:
```json
{
  "name": "@developmentseed/deck.gl-healpix-zarr",
  "version": "0.1.0",
  "description": "HEALPix Zarr tile pyramid layer for deck.gl",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "files": ["dist", "src"],
  "scripts": {
    "build": "rollup -c ../../rollup.config.mjs",
    "build:watch": "rollup -c ../../rollup.config.mjs --watch",
    "test": "jest",
    "ts-check": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint src",
    "clean": "rm -rf dist",
    "prepublishOnly": "npm run clean && npm run build"
  },
  "author": {
    "name": "Daniel da Silva",
    "email": "daniel@developmentseed.org"
  },
  "license": "MIT",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "peerDependencies": {
    "@deck.gl/core": "~9.3.1",
    "@deck.gl/geo-layers": "~9.3.1",
    "@deck.gl/layers": "~9.3.1",
    "@luma.gl/core": "9.3.3",
    "@luma.gl/engine": "9.3.3",
    "healpix-ts": "^1.0.0",
    "zarrita": "^0.6.1"
  },
  "dependencies": {
    "@developmentseed/deck.gl-healpix": "*"
  },
  "devDependencies": {
    "@deck.gl/geo-layers": "~9.3.1",
    "healpix-ts": "^1.0.0",
    "zarrita": "^0.6.1"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

`packages/deck.gl-healpix-zarr/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 3: Create tsconfig.jest.json**

`packages/deck.gl-healpix-zarr/tsconfig.jest.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "types": ["jest", "node"]
  }
}
```

- [ ] **Step 4: Create jest.config.ts**

`packages/deck.gl-healpix-zarr/jest.config.ts`:
```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.jest.json'
      }
    ]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  }
};

export default config;
```

- [ ] **Step 5: Create stub src/index.ts**

`packages/deck.gl-healpix-zarr/src/index.ts`:
```typescript
// exports wired in Task 7
export {};
```

- [ ] **Step 6: Install workspace deps from repo root**

```bash
npm install
```

Expected: resolves workspaces, symlinks `@developmentseed/deck.gl-healpix-zarr` in root `node_modules`. No errors.

- [ ] **Step 7: Verify Jest runs (no tests yet)**

```bash
cd packages/deck.gl-healpix-zarr && npx jest --passWithNoTests
```

Expected: `Test Suites: 0 passed, 0 total`

- [ ] **Step 8: Commit**

```bash
git add packages/deck.gl-healpix-zarr/
git commit -m "feat(healpix-zarr): scaffold deck.gl-healpix-zarr package"
```

---

## Task 2: Types

**Files:**
- Create: `packages/deck.gl-healpix-zarr/src/types.ts`

- [ ] **Step 1: Create types.ts**

`packages/deck.gl-healpix-zarr/src/types.ts`:
```typescript
/**
 * Tile index used by HealpixTileset2D.
 * x = parent cell (NESTED scheme, at nside_parent)
 * y = 0 (unused)
 * z = log2(nside) — the data resolution, not deck.gl zoom
 */
export interface HealpixTileIndex {
  x: number;
  y: 0;
  z: number;
}

/** Data returned by HealpixZarrTileLayer.getTileData for each tile. */
export interface HealpixZarrTileData {
  nside: number;
  cellIds: Float64Array;
  /** Flat interleaved values: cell i starts at i * bands.length. */
  values: Float32Array;
  bands: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/deck.gl-healpix-zarr/src/types.ts
git commit -m "feat(healpix-zarr): add HealpixTileIndex and HealpixZarrTileData types"
```

---

## Task 3: Utils (TDD)

**Files:**
- Create: `packages/deck.gl-healpix-zarr/src/utils.test.ts`
- Create: `packages/deck.gl-healpix-zarr/src/utils.ts`

- [ ] **Step 1: Write failing tests**

`packages/deck.gl-healpix-zarr/src/utils.test.ts`:
```typescript
import { clampToAvailable, getNsideForZoom, rowRangeFromOffsetPair } from './utils.js';

describe('clampToAvailable', () => {
  const nsides = [128, 512, 2048];

  it('returns exact match when present', () => {
    expect(clampToAvailable(512, nsides)).toBe(512);
  });

  it('returns coarsest when nside is below all available', () => {
    expect(clampToAvailable(64, nsides)).toBe(128);
  });

  it('returns finest when nside is above all available', () => {
    expect(clampToAvailable(8192, nsides)).toBe(2048);
  });

  it('returns nearest coarser nside for a value between levels', () => {
    // 300 is between 128 and 512 — pick 128 (coarser bias)
    expect(clampToAvailable(300, nsides)).toBe(128);
  });
});

describe('getNsideForZoom', () => {
  it('returns 2^(round(zoom + offset))', () => {
    // zoom=3, offset=5 → 2^8 = 256; clamp to [128, 512] → 256
    expect(getNsideForZoom(3, 5, [128, 256, 512])).toBe(256);
  });

  it('clamps to coarsest when zoom is very low', () => {
    expect(getNsideForZoom(-5, 5, [128, 512])).toBe(128);
  });

  it('clamps to finest when zoom is very high', () => {
    expect(getNsideForZoom(20, 5, [128, 512])).toBe(512);
  });
});

describe('rowRangeFromOffsetPair', () => {
  it('returns rowStart and rowEnd for valid non-empty range', () => {
    const pair = new BigInt64Array([10n, 25n]);
    expect(rowRangeFromOffsetPair(pair)).toEqual({ rowStart: 10, rowEnd: 25 });
  });

  it('returns null for empty range (start === end)', () => {
    const pair = new BigInt64Array([10n, 10n]);
    expect(rowRangeFromOffsetPair(pair)).toBeNull();
  });

  it('returns null when pair has fewer than 2 elements', () => {
    const pair = new BigInt64Array([10n]);
    expect(rowRangeFromOffsetPair(pair)).toBeNull();
  });

  it('handles number array (not just BigInt64Array)', () => {
    expect(rowRangeFromOffsetPair([5, 20])).toEqual({ rowStart: 5, rowEnd: 20 });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/deck.gl-healpix-zarr && npx jest src/utils.test.ts
```

Expected: FAIL — `Cannot find module './utils.js'`

- [ ] **Step 3: Implement utils.ts**

`packages/deck.gl-healpix-zarr/src/utils.ts`:
```typescript
export interface ParentRowRange {
  rowStart: number;
  rowEnd: number;
}

/**
 * Pick the largest available nside that is ≤ target.
 * Falls back to the coarsest if target is below all available,
 * or the finest if target is above all available.
 * `available` must be sorted ascending.
 */
export function clampToAvailable(target: number, available: number[]): number {
  if (available.length === 0) throw new Error('available nsides is empty');
  let best = available[0];
  for (const n of available) {
    if (n <= target) best = n;
    else break;
  }
  return best;
}

/**
 * Derive nside from deck.gl viewport zoom.
 * Formula: nside = 2^round(zoom + zoomOffset), clamped to available pyramid levels.
 * Default zoomOffset=5 maps zoom=3 → nside=256, zoom=4 → 512, etc.
 */
export function getNsideForZoom(
  zoom: number,
  zoomOffset: number,
  available: number[]
): number {
  const nsidePower = Math.round(zoom + zoomOffset);
  const nside = Math.pow(2, nsidePower);
  return clampToAvailable(nside, available);
}

/** Decode a 2-element slice [offsets[p], offsets[p+1]] from Zarr. */
export function rowRangeFromOffsetPair(
  pair: ArrayLike<bigint | number>
): ParentRowRange | null {
  if (pair.length < 2) return null;
  const rowStart = Number(pair[0]);
  const rowEnd = Number(pair[1]);
  if (rowStart >= rowEnd) return null;
  return { rowStart, rowEnd };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/deck.gl-healpix-zarr && npx jest src/utils.test.ts
```

Expected: PASS — 9 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/deck.gl-healpix-zarr/src/utils.ts packages/deck.gl-healpix-zarr/src/utils.test.ts
git commit -m "feat(healpix-zarr): add utils — clampToAvailable, getNsideForZoom, rowRangeFromOffsetPair"
```

---

## Task 4: CachedZarrStore (TDD)

**Files:**
- Create: `packages/deck.gl-healpix-zarr/src/cached-zarr-store.test.ts`
- Create: `packages/deck.gl-healpix-zarr/src/cached-zarr-store.ts`

- [ ] **Step 1: Write failing tests**

`packages/deck.gl-healpix-zarr/src/cached-zarr-store.test.ts`:
```typescript
import { CachedZarrStore } from './cached-zarr-store.js';

// Minimal zarrita FetchStore shape
function makeMockFetchStore(response: Uint8Array | undefined = new Uint8Array([1, 2, 3])) {
  let callCount = 0;
  return {
    get callCount() { return callCount; },
    store: {
      get: jest.fn(async () => { callCount++; return response; }),
      getRange: jest.fn(async () => { callCount++; return response; }),
    }
  };
}

describe('CachedZarrStore', () => {
  it('fetches on first get', async () => {
    const store = new CachedZarrStore('http://example.com');
    // Patch internal FetchStore
    const mockGet = jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    (store as any)['_base'] = { get: mockGet, getRange: jest.fn() };

    const result = await store.get('/foo/c/0');
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('returns cached value on second get without fetching again', async () => {
    const store = new CachedZarrStore('http://example.com');
    const mockGet = jest.fn().mockResolvedValue(new Uint8Array([42]));
    (store as any)['_base'] = { get: mockGet, getRange: jest.fn() };

    await store.get('/foo/c/0');
    await store.get('/foo/c/0');
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(store.stats.cacheHits).toBe(1);
  });

  it('deduplicates concurrent requests to the same key', async () => {
    const store = new CachedZarrStore('http://example.com');
    let resolve!: (v: Uint8Array) => void;
    const pending = new Promise<Uint8Array>(r => { resolve = r; });
    const mockGet = jest.fn().mockReturnValue(pending);
    (store as any)['_base'] = { get: mockGet, getRange: jest.fn() };

    const [a, b] = await Promise.all([
      store.get('/foo/c/0'),
      store.get('/foo/c/0').then(() => { resolve(new Uint8Array([7])); return store.get('/foo/c/0'); })
    ]);
    resolve(new Uint8Array([7]));
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(store.stats.deduped).toBeGreaterThanOrEqual(1);
  });

  it('evicts oldest entry when maxCacheEntries is exceeded', async () => {
    const store = new CachedZarrStore('http://example.com', { maxCacheEntries: 2 });
    let callN = 0;
    const mockGet = jest.fn().mockImplementation(async () => new Uint8Array([callN++]));
    (store as any)['_base'] = { get: mockGet, getRange: jest.fn() };

    await store.get('/a/c/0');
    await store.get('/b/c/0');
    await store.get('/c/c/0'); // should evict /a

    expect(store.cacheSize).toBe(2);
    // /a evicted — fetches again
    await store.get('/a/c/0');
    expect(mockGet).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/deck.gl-healpix-zarr && npx jest src/cached-zarr-store.test.ts
```

Expected: FAIL — `Cannot find module './cached-zarr-store.js'`

- [ ] **Step 3: Implement cached-zarr-store.ts**

`packages/deck.gl-healpix-zarr/src/cached-zarr-store.ts`:
```typescript
import * as zarr from 'zarrita';

type AbsolutePath = `/${string}`;
type RangeQuery = { offset: number; length: number } | { suffixLength: number };

function rangeKey(key: AbsolutePath, range: RangeQuery): string {
  if ('suffixLength' in range) return `${key}@suffix:${range.suffixLength}`;
  return `${key}@${range.offset}:${range.length}`;
}

export interface CachedZarrStoreStats {
  requests: number;
  cacheHits: number;
  deduped: number;
  fetches: number;
}

/**
 * Zarrita-compatible store with in-memory LRU chunk cache and in-flight
 * request deduplication. Drop-in replacement for zarrita.FetchStore.
 *
 * Complements Tileset2D's tile-level cache: prevents duplicate HTTP requests
 * when concurrent tiles read the same zarr chunk, and serves chunks from
 * memory when an evicted tile is re-requested.
 */
export class CachedZarrStore {
  readonly url: string | URL;
  stats: CachedZarrStoreStats = { requests: 0, cacheHits: 0, deduped: 0, fetches: 0 };

  private _base: zarr.FetchStore;
  private _cache: Map<string, Uint8Array | undefined>;
  private _inflight: Map<string, Promise<Uint8Array | undefined>>;
  private _maxEntries: number;

  constructor(
    url: string | URL,
    options: { overrides?: RequestInit; useSuffixRequest?: boolean; maxCacheEntries?: number } = {}
  ) {
    this.url = url;
    this._base = new zarr.FetchStore(url, options);
    this._cache = new Map();
    this._inflight = new Map();
    this._maxEntries = options.maxCacheEntries ?? 2048;
  }

  resetStats(): void {
    this.stats = { requests: 0, cacheHits: 0, deduped: 0, fetches: 0 };
  }

  clearCache(): void {
    this._cache.clear();
    this._inflight.clear();
  }

  get cacheSize(): number {
    return this._cache.size;
  }

  async get(key: AbsolutePath, options?: RequestInit): Promise<Uint8Array | undefined> {
    this.stats.requests++;
    return this._resolve(key, () => {
      this.stats.fetches++;
      return this._base.get(key, options);
    });
  }

  async getRange(key: AbsolutePath, range: RangeQuery, options?: RequestInit): Promise<Uint8Array | undefined> {
    this.stats.requests++;
    return this._resolve(rangeKey(key, range), () => {
      this.stats.fetches++;
      return this._base.getRange(key, range, options);
    });
  }

  private _resolve(
    cacheKey: string,
    fetchFn: () => Promise<Uint8Array | undefined>
  ): Promise<Uint8Array | undefined> {
    if (this._cache.has(cacheKey)) {
      this.stats.cacheHits++;
      return Promise.resolve(this._cache.get(cacheKey));
    }

    const inflight = this._inflight.get(cacheKey);
    if (inflight) {
      this.stats.deduped++;
      return inflight;
    }

    const promise = fetchFn().then(
      result => {
        this._inflight.delete(cacheKey);
        this._evictIfNeeded();
        this._cache.set(cacheKey, result);
        return result;
      },
      (error: unknown) => {
        this._inflight.delete(cacheKey);
        throw error;
      }
    );

    this._inflight.set(cacheKey, promise);
    return promise;
  }

  private _evictIfNeeded(): void {
    if (this._cache.size < this._maxEntries) return;
    const first = this._cache.keys().next().value;
    if (first !== undefined) this._cache.delete(first);
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/deck.gl-healpix-zarr && npx jest src/cached-zarr-store.test.ts
```

Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/deck.gl-healpix-zarr/src/cached-zarr-store.ts packages/deck.gl-healpix-zarr/src/cached-zarr-store.test.ts
git commit -m "feat(healpix-zarr): add CachedZarrStore with LRU cache and request dedup"
```

---

## Task 5: HealpixTileset2D (TDD)

**Files:**
- Create: `packages/deck.gl-healpix-zarr/src/healpix-tileset-2d.test.ts`
- Create: `packages/deck.gl-healpix-zarr/src/healpix-tileset-2d.ts`

- [ ] **Step 1: Write failing tests**

`packages/deck.gl-healpix-zarr/src/healpix-tileset-2d.test.ts`:
```typescript
import { WebMercatorViewport } from '@deck.gl/core';
import { HealpixTileset2D } from './healpix-tileset-2d.js';

const noopGetTileData = () => Promise.resolve(null);

function makeTileset(opts: Partial<ConstructorParameters<typeof HealpixTileset2D>[0]> = {}) {
  return new HealpixTileset2D({ getTileData: noopGetTileData, ...opts });
}

describe('HealpixTileset2D', () => {
  describe('getTileIndices', () => {
    it('returns [] before metadata is set', () => {
      const tileset = makeTileset();
      const viewport = new WebMercatorViewport({ width: 800, height: 600, longitude: 0, latitude: 0, zoom: 3 });
      const indices = tileset.getTileIndices({ viewport, zRange: null });
      expect(indices).toEqual([]);
    });

    it('returns tile indices after metadata is injected', () => {
      const tileset = makeTileset({
        zoomOffset: 5,
        availableNsides: [128],
        nsideParentMap: new Map([[128, 32]])
      });
      const viewport = new WebMercatorViewport({ width: 800, height: 600, longitude: 0, latitude: 0, zoom: 2 });
      // zoom=2, offset=5 → nside=2^7=128. nsideParent=32. Some cells must cover viewport.
      const indices = tileset.getTileIndices({ viewport, zRange: null });
      expect(indices.length).toBeGreaterThan(0);
      for (const idx of indices) {
        expect(idx.y).toBe(0);
        expect(typeof idx.x).toBe('number');
        expect(typeof idx.z).toBe('number');
        // z = log2(128) = 7
        expect(idx.z).toBe(7);
        // x must be a valid parent cell at nsideParent=32
        expect(idx.x).toBeGreaterThanOrEqual(0);
        expect(idx.x).toBeLessThan(12 * 32 * 32);
      }
    });
  });

  describe('getTileId', () => {
    it('returns a string unique to (z, x)', () => {
      const tileset = makeTileset();
      expect(tileset.getTileId({ x: 5, y: 0, z: 9 })).toBe('9-5');
      expect(tileset.getTileId({ x: 0, y: 0, z: 7 })).toBe('7-0');
    });
  });

  describe('getTileZoom', () => {
    it('returns z', () => {
      const tileset = makeTileset();
      expect(tileset.getTileZoom({ x: 0, y: 0, z: 9 })).toBe(9);
    });
  });

  describe('getParentIndex', () => {
    it('returns floor(x/4) at z-1', () => {
      const tileset = makeTileset();
      expect(tileset.getParentIndex({ x: 8, y: 0, z: 9 })).toEqual({ x: 2, y: 0, z: 8 });
      expect(tileset.getParentIndex({ x: 9, y: 0, z: 9 })).toEqual({ x: 2, y: 0, z: 8 });
      expect(tileset.getParentIndex({ x: 0, y: 0, z: 9 })).toEqual({ x: 0, y: 0, z: 8 });
    });

    it('handles large cell indices beyond 32-bit range', () => {
      const tileset = makeTileset();
      // 12 * 16384^2 = ~3.2B which exceeds 2^31 — bitwise >> 2 would break
      const largeCell = 3_000_000_000;
      expect(tileset.getParentIndex({ x: largeCell, y: 0, z: 15 })).toEqual({
        x: Math.floor(largeCell / 4),
        y: 0,
        z: 14
      });
    });
  });

  describe('setOptions (metadata injection)', () => {
    it('returns indices after setOptions injects metadata', () => {
      const tileset = makeTileset({ zoomOffset: 5 });
      const viewport = new WebMercatorViewport({ width: 800, height: 600, longitude: 0, latitude: 0, zoom: 2 });

      // Before: empty
      expect(tileset.getTileIndices({ viewport, zRange: null })).toEqual([]);

      // Inject metadata
      tileset.setOptions({
        getTileData: noopGetTileData,
        availableNsides: [128],
        nsideParentMap: new Map([[128, 32]])
      });

      // After: has indices
      expect(tileset.getTileIndices({ viewport, zRange: null }).length).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/deck.gl-healpix-zarr && npx jest src/healpix-tileset-2d.test.ts
```

Expected: FAIL — `Cannot find module './healpix-tileset-2d.js'`

- [ ] **Step 3: Implement healpix-tileset-2d.ts**

`packages/deck.gl-healpix-zarr/src/healpix-tileset-2d.ts`:
```typescript
import { Tileset2D, type Tileset2DProps } from '@deck.gl/geo-layers';
import type { Viewport } from '@deck.gl/core';
import { queryBoxInclusiveNest } from 'healpix-ts';
import { clampToAvailable } from './utils.js';

export type HealpixTileset2DProps = Tileset2DProps & {
  availableNsides?: number[];
  nsideParentMap?: Map<number, number>;
};

/**
 * Tileset2D subclass that maps a deck.gl viewport to HEALPix parent cells.
 *
 * Tile index convention: x = parent cell (NESTED), y = 0, z = log2(nside).
 *
 * Inject zarr metadata after async bootstrap:
 *   tileset.setOptions({ availableNsides, nsideParentMap });
 * Until metadata is set, getTileIndices returns [] (no tiles loaded).
 */
export class HealpixTileset2D extends Tileset2D {
  private _availableNsides: number[] = [];
  private _nsideParentMap: Map<number, number> = new Map();

  constructor(opts: HealpixTileset2DProps) {
    super(opts);
    this._availableNsides = opts.availableNsides ?? [];
    this._nsideParentMap = opts.nsideParentMap ?? new Map();
  }

  override setOptions(opts: HealpixTileset2DProps): void {
    super.setOptions(opts);
    if (opts.availableNsides !== undefined) this._availableNsides = opts.availableNsides;
    if (opts.nsideParentMap !== undefined) this._nsideParentMap = opts.nsideParentMap;
  }

  override getTileIndices({ viewport }: { viewport: Viewport; [key: string]: unknown }): { x: number; y: 0; z: number }[] {
    if (this._availableNsides.length === 0) return [];

    const zoomOffset = (this.opts as Tileset2DProps & { zoomOffset?: number }).zoomOffset ?? 0;
    const nside = clampToAvailable(
      Math.pow(2, Math.round(viewport.zoom + zoomOffset)),
      this._availableNsides
    );
    const nsideParent = this._nsideParentMap.get(nside);
    if (!nsideParent) return [];

    const topLeft = viewport.unproject([0, 0]);
    const bottomRight = viewport.unproject([viewport.width, viewport.height]);
    const bounds: [number, number, number, number] = [
      Math.min(topLeft[0], bottomRight[0]),
      Math.min(topLeft[1], bottomRight[1]),
      Math.max(topLeft[0], bottomRight[0]),
      Math.max(topLeft[1], bottomRight[1])
    ];

    const z = Math.log2(nside);
    return (queryBoxInclusiveNest(nsideParent, bounds) as number[]).map(x => ({ x, y: 0 as const, z }));
  }

  override getTileId(index: { x: number; y: number; z: number }): string {
    return `${index.z}-${index.x}`;
  }

  override getTileZoom(index: { x: number; y: number; z: number }): number {
    return index.z;
  }

  override getTileMetadata(index: { x: number; y: number; z: number }): Record<string, unknown> {
    return { nside: Math.pow(2, index.z) };
  }

  override getParentIndex(index: { x: number; y: number; z: number }): { x: number; y: 0; z: number } {
    return { x: Math.floor(index.x / 4), y: 0, z: index.z - 1 };
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/deck.gl-healpix-zarr && npx jest src/healpix-tileset-2d.test.ts
```

Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/deck.gl-healpix-zarr/src/healpix-tileset-2d.ts packages/deck.gl-healpix-zarr/src/healpix-tileset-2d.test.ts
git commit -m "feat(healpix-zarr): add HealpixTileset2D with HEALPix tile indexing"
```

---

## Task 6: HealpixZarrTileLayer (TDD)

**Files:**
- Create: `packages/deck.gl-healpix-zarr/src/healpix-zarr-tile-layer.test.ts`
- Create: `packages/deck.gl-healpix-zarr/src/healpix-zarr-tile-layer.ts`

- [ ] **Step 1: Write failing tests**

`packages/deck.gl-healpix-zarr/src/healpix-zarr-tile-layer.test.ts`:
```typescript
import { loadTileFromGroup, type GroupHandle } from './healpix-zarr-tile-layer.js';

function makeGroupHandle(overrides: Partial<GroupHandle> = {}): GroupHandle {
  const cellIds = new Float64Array([100, 200, 300]);
  const values = new Float32Array([0.1, 0.5, 0.9]);

  return {
    nside: 128,
    nsideParent: 32,
    numBands: 1,
    bands: ['B01'],
    parentOffsetsArr: {
      // zarr.get mock — returns BigInt64Array [rowStart, rowEnd]
      _mockOffsets: new BigInt64Array([0n, 3n])
    } as unknown as GroupHandle['parentOffsetsArr'],
    cellIdArr: {
      _mockData: cellIds
    } as unknown as GroupHandle['cellIdArr'],
    valueArr: {
      _mockData: values
    } as unknown as GroupHandle['valueArr'],
    ...overrides
  };
}

// Spy on zarr.get so we can return controlled data
jest.mock('zarrita', () => {
  return {
    get: jest.fn(async (arr: { _mockOffsets?: BigInt64Array; _mockData?: Float64Array | Float32Array }, _sel: unknown[]) => {
      if (arr._mockOffsets) return { data: arr._mockOffsets };
      if (arr._mockData) return { data: arr._mockData };
      throw new Error('Unexpected zarr.get call');
    }),
    slice: (start: number, end: number) => ({ start, end })
  };
});

describe('loadTileFromGroup', () => {
  it('returns null for empty parent (start === end in offsets)', async () => {
    const group = makeGroupHandle();
    (group.parentOffsetsArr as any)._mockOffsets = new BigInt64Array([5n, 5n]);
    const result = await loadTileFromGroup(group, 0);
    expect(result).toBeNull();
  });

  it('returns correct nside, cellIds, values, bands for valid parent', async () => {
    const group = makeGroupHandle();
    const result = await loadTileFromGroup(group, 0);
    expect(result).not.toBeNull();
    expect(result!.nside).toBe(128);
    expect(result!.bands).toEqual(['B01']);
    expect(result!.cellIds.length).toBe(3);
    expect(result!.values.length).toBe(3);
  });

  it('returns null when AbortSignal is already aborted', async () => {
    const group = makeGroupHandle();
    const controller = new AbortController();
    controller.abort();
    const result = await loadTileFromGroup(group, 0, controller.signal).catch(() => null);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/deck.gl-healpix-zarr && npx jest src/healpix-zarr-tile-layer.test.ts
```

Expected: FAIL — `Cannot find module './healpix-zarr-tile-layer.js'`

- [ ] **Step 3: Implement healpix-zarr-tile-layer.ts**

`packages/deck.gl-healpix-zarr/src/healpix-zarr-tile-layer.ts`:
```typescript
import { CompositeLayerProps, DefaultProps } from '@deck.gl/core';
import { TileLayer, type TileLayerProps } from '@deck.gl/geo-layers';
import * as zarr from 'zarrita';
import { HealpixCellsLayer } from '@developmentseed/deck.gl-healpix';
import { CachedZarrStore } from './cached-zarr-store.js';
import { HealpixTileset2D } from './healpix-tileset-2d.js';
import { rowRangeFromOffsetPair } from './utils.js';
import type { HealpixZarrTileData } from './types.js';

export type { HealpixZarrTileData };

export interface GroupHandle {
  nside: number;
  nsideParent: number;
  numBands: number;
  bands: string[];
  cellIdArr: zarr.Array<zarr.DataType, CachedZarrStore>;
  valueArr: zarr.Array<zarr.DataType, CachedZarrStore>;
  parentOffsetsArr: zarr.Array<zarr.DataType, CachedZarrStore>;
}

// Module-level caches keyed by URL (shared across layer instances with the same URL)
const rootCache = new Map<string, Promise<zarr.Group<CachedZarrStore>>>();
const groupHandleCache = new Map<string, Promise<GroupHandle>>();
const storeCache = new Map<string, CachedZarrStore>();

function getStore(url: string): CachedZarrStore {
  if (!storeCache.has(url)) storeCache.set(url, new CachedZarrStore(url));
  return storeCache.get(url)!;
}

function getRoot(url: string): Promise<zarr.Group<CachedZarrStore>> {
  if (!rootCache.has(url)) {
    const store = getStore(url);
    rootCache.set(url, zarr.open(store, { kind: 'group' }) as Promise<zarr.Group<CachedZarrStore>>);
  }
  return rootCache.get(url)!;
}

function getGroupHandle(url: string, nside: number): Promise<GroupHandle> {
  const key = `${url}:${nside}`;
  if (!groupHandleCache.has(key)) {
    groupHandleCache.set(key, (async () => {
      const root = await getRoot(url);
      const grp = await zarr.open.v3(root.resolve(`nside_${nside}`), { kind: 'group' });
      const [cellIdArr, valueArr, parentOffsetsArr] = await Promise.all([
        zarr.open.v3(grp.resolve('cell_id'), { kind: 'array' }),
        zarr.open.v3(grp.resolve('values'), { kind: 'array' }),
        zarr.open.v3(grp.resolve('parent_offsets'), { kind: 'array' })
      ]);
      const bands = (root.attrs.bands as string[] | undefined) ?? [];
      const numBands = Number(valueArr.shape[1] ?? 1);
      return {
        nside,
        nsideParent: grp.attrs.nside_parent as number,
        numBands,
        bands,
        cellIdArr: cellIdArr as zarr.Array<zarr.DataType, CachedZarrStore>,
        valueArr: valueArr as zarr.Array<zarr.DataType, CachedZarrStore>,
        parentOffsetsArr: parentOffsetsArr as zarr.Array<zarr.DataType, CachedZarrStore>
      } satisfies GroupHandle;
    })());
  }
  return groupHandleCache.get(key)!;
}

/** Load one tile from a zarr group. Exported for unit testing. */
export async function loadTileFromGroup(
  group: GroupHandle,
  parentCell: number,
  signal?: AbortSignal
): Promise<HealpixZarrTileData | null> {
  if (signal?.aborted) return null;

  const poResult = await zarr.get(group.parentOffsetsArr, [zarr.slice(parentCell, parentCell + 2)]);
  const range = rowRangeFromOffsetPair(poResult.data as BigInt64Array);
  if (!range) return null;

  if (signal?.aborted) return null;

  const { rowStart, rowEnd } = range;
  const [idsResult, valsResult] = await Promise.all([
    zarr.get(group.cellIdArr, [zarr.slice(rowStart, rowEnd)]),
    zarr.get(group.valueArr, [zarr.slice(rowStart, rowEnd), zarr.slice(0, group.numBands)])
  ]);

  return {
    nside: group.nside,
    cellIds: idsResult.data as Float64Array,
    values: valsResult.data as Float32Array,
    bands: group.bands
  };
}

type _HealpixZarrTileLayerProps = {
  url: string;
  colorMap?: Uint8Array;
  min?: number;
  max?: number;
  dimensions?: 1 | 2 | 3 | 4;
};

export type HealpixZarrTileLayerProps = _HealpixZarrTileLayerProps &
  Omit<TileLayerProps<HealpixZarrTileData | null>, 'data'> &
  CompositeLayerProps;

const defaultProps: DefaultProps<_HealpixZarrTileLayerProps & { zoomOffset: number }> = {
  // @ts-expect-error deck.gl DefaultProps has no 'string' type
  url: { type: 'string', value: '' },
  zoomOffset: 5,
  min: 0,
  max: 1,
  dimensions: 1,
  colorMap: { type: 'object', value: null, compare: true }
};

type HealpixZarrState = {
  availableNsides: number[];
  nsideParentMap: Map<number, number>;
};

/**
 * Deck.gl layer that renders HEALPix Zarr tile pyramids.
 *
 * Extends TileLayer with HealpixTileset2D for HEALPix-aware tile indexing.
 * Values are passed through to HealpixCellsLayer — color mapping is the
 * consumer's responsibility via colorMap / min / max / dimensions props.
 */
export class HealpixZarrTileLayer extends TileLayer<HealpixZarrTileData | null> {
  static layerName = 'HealpixZarrTileLayer';
  static defaultProps = defaultProps;

  declare state: TileLayer['state'] & HealpixZarrState;

  override initializeState(): void {
    super.initializeState();
    this.setState({ availableNsides: [], nsideParentMap: new Map() });
    void this._initMetadata(this.props.url as string);
  }

  private async _initMetadata(url: string): Promise<void> {
    if (!url) return;
    try {
      const root = await getRoot(url);
      const baseNside = root.attrs.base_nside as number;
      const minNside = root.attrs.min_nside as number;

      const availableNsides: number[] = [];
      const nsideParentMap = new Map<number, number>();

      for (let n = minNside; n <= baseNside; n *= 2) {
        const grp = await zarr.open.v3(root.resolve(`nside_${n}`), { kind: 'group' });
        const nsideParent = grp.attrs.nside_parent as number;
        availableNsides.push(n);
        nsideParentMap.set(n, nsideParent);
      }

      this.setState({ availableNsides, nsideParentMap });
      this.setNeedsUpdate();
    } catch (e) {
      console.error('[HealpixZarrTileLayer] metadata init failed', e);
    }
  }

  protected override _getTilesetOptions() {
    return {
      ...super._getTilesetOptions(),
      availableNsides: this.state.availableNsides,
      nsideParentMap: this.state.nsideParentMap
    };
  }

  override getTileData(tile: { index: { x: number; y: number; z: number }; signal?: AbortSignal }): Promise<HealpixZarrTileData | null> {
    const url = this.props.url as string;
    const { x: parentCell, z: nsidePower } = tile.index;
    const nside = Math.pow(2, nsidePower);
    return getGroupHandle(url, nside).then(group =>
      loadTileFromGroup(group, parentCell, tile.signal)
    );
  }

  override renderSubLayers(
    props: Parameters<TileLayer<HealpixZarrTileData | null>['renderSubLayers']>[0]
  ) {
    const data = props.data as HealpixZarrTileData | null;
    if (!data || data.cellIds.length === 0) return null;
    const { colorMap, min, max, dimensions } = this.props as HealpixZarrTileLayerProps;
    return new HealpixCellsLayer(
      this.getSubLayerProps({
        id: props.id,
        nside: data.nside,
        cellIds: data.cellIds,
        values: data.values,
        colorMap: colorMap ?? null,
        min: min ?? 0,
        max: max ?? 1,
        dimensions: dimensions ?? 1
      })
    );
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/deck.gl-healpix-zarr && npx jest src/healpix-zarr-tile-layer.test.ts
```

Expected: PASS — 3 tests passed.

- [ ] **Step 5: Run full test suite**

```bash
cd packages/deck.gl-healpix-zarr && npx jest
```

Expected: all tests in the package pass.

- [ ] **Step 6: Commit**

```bash
git add packages/deck.gl-healpix-zarr/src/healpix-zarr-tile-layer.ts packages/deck.gl-healpix-zarr/src/healpix-zarr-tile-layer.test.ts
git commit -m "feat(healpix-zarr): add HealpixZarrTileLayer and loadTileFromGroup"
```

---

## Task 7: Wire exports and verify build

**Files:**
- Modify: `packages/deck.gl-healpix-zarr/src/index.ts`

- [ ] **Step 1: Update index.ts**

`packages/deck.gl-healpix-zarr/src/index.ts`:
```typescript
export { HealpixZarrTileLayer } from './healpix-zarr-tile-layer.js';
export type { HealpixZarrTileLayerProps, HealpixZarrTileData } from './healpix-zarr-tile-layer.js';
export { HealpixTileset2D } from './healpix-tileset-2d.js';
export type { HealpixTileset2DProps } from './healpix-tileset-2d.js';
export { CachedZarrStore } from './cached-zarr-store.js';
export type { CachedZarrStoreStats } from './cached-zarr-store.js';
export { clampToAvailable, getNsideForZoom, rowRangeFromOffsetPair } from './utils.js';
export type { HealpixTileIndex } from './types.js';
```

- [ ] **Step 2: TypeScript check**

```bash
cd packages/deck.gl-healpix-zarr && npm run ts-check
```

Expected: no errors.

- [ ] **Step 3: Build**

```bash
cd packages/deck.gl-healpix-zarr && npm run build
```

Expected: `dist/index.js`, `dist/index.mjs`, `dist/index.d.ts` created. No errors.

- [ ] **Step 4: Verify exports in built output**

```bash
node -e "const m = require('./packages/deck.gl-healpix-zarr/dist/index.js'); console.log(Object.keys(m).join(', '))"
```

Expected output includes: `HealpixZarrTileLayer, HealpixTileset2D, CachedZarrStore, clampToAvailable, getNsideForZoom, rowRangeFromOffsetPair`

- [ ] **Step 5: Commit**

```bash
git add packages/deck.gl-healpix-zarr/src/index.ts packages/deck.gl-healpix-zarr/dist/
git commit -m "feat(healpix-zarr): wire public exports and build dist"
```

---

## Task 8: README

**Files:**
- Create: `packages/deck.gl-healpix-zarr/README.md`

- [ ] **Step 1: Write README.md**

`packages/deck.gl-healpix-zarr/README.md`:

````markdown
# @developmentseed/deck.gl-healpix-zarr

A deck.gl layer for rendering HEALPix Zarr tile pyramids.

Integrates with deck.gl's `TileLayer` infrastructure for viewport-driven tile loading, LRU caching, request scheduling, and best-available refinement (a coarser cached tile renders as placeholder while finer tiles load).

## Installation

```bash
npm install @developmentseed/deck.gl-healpix-zarr
```

Peer dependencies: `@deck.gl/core`, `@deck.gl/geo-layers`, `zarrita`, `healpix-ts`

## Usage

```tsx
import { HealpixZarrTileLayer } from '@developmentseed/deck.gl-healpix-zarr';
import { makeColorMap } from '@developmentseed/deck.gl-healpix';
import { interpolateViridis, scaleSequential } from 'd3';

const colorMap = makeColorMap((t) => {
  const [r, g, b] = scaleSequential(interpolateViridis)(t)
    .replace(/[^\d,]/g, '').split(',').map(Number);
  return [r, g, b, 255];
});

const layer = new HealpixZarrTileLayer({
  id: 'my-zarr-layer',
  url: 'https://example.com/my-data.zarr',
  colorMap,
  min: 0,
  max: 1,
  dimensions: 1,
  opacity: 0.9,
  zoomOffset: 5  // increase for finer tiles at same zoom
});
```

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | `''` | Zarr store root URL |
| `zoomOffset` | `number` | `5` | Shifts nside selection: nside = 2^round(zoom + zoomOffset) |
| `colorMap` | `Uint8Array \| null` | `null` | 256×4 RGBA LUT; use `makeColorMap()` from `deck.gl-healpix` |
| `min` | `number` | `0` | Value mapped to colorMap index 0 |
| `max` | `number` | `1` | Value mapped to colorMap index 255 |
| `dimensions` | `1 \| 2 \| 3 \| 4` | `1` | Values per cell — see `HealpixCellsLayer` docs |

All standard `TileLayer` props are also accepted (`maxCacheSize`, `refinementStrategy`, `maxRequests`, `onTileLoad`, etc.).

## Zarr Store Format

The layer expects a Zarr v3 store with this layout:

```
{root}/
  .zattrs:
    base_nside: int          # finest pyramid level
    min_nside:  int          # coarsest pyramid level
    bands:      string[]     # e.g. ["B02","B03","B04","B08"]

  nside_{N}/
    .zattrs:
      nside_parent: int      # parent nside for tile indexing (typically N/4)
    cell_id:   float64[rows]           # NESTED cell index at nside N
    values:    float32[rows, bands]    # one row per occupied cell
    parent_offsets: int64[12*nside_parent²+1]  # CSR index
```

### Invariants

- `cell_id` uses the NESTED scheme.
- `parent_offsets` is dense over all parent cells; empty parents have `offsets[p] == offsets[p+1]`.
- Cells within a parent's row range need not be sorted.

### Recommended chunking

Chunk `cell_id` and `values` at 1024–4096 rows (power of 2). Keep `parent_offsets` in a single chunk.

## Architecture

```
HealpixZarrTileLayer (extends TileLayer)
  └─ HealpixTileset2D (extends Tileset2D)     viewport → HEALPix parent cells
       tile cache + request scheduling         handled by deck.gl Tileset2D
  └─ CachedZarrStore                          zarr chunk LRU + dedup
  └─ HealpixCellsLayer (per tile)             GPU rendering
```

`CachedZarrStore` is exported and can be used standalone as a caching zarrita FetchStore.
````

- [ ] **Step 2: Commit**

```bash
git add packages/deck.gl-healpix-zarr/README.md
git commit -m "docs(healpix-zarr): add README with usage, API, and zarr format docs"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `packages/deck.gl-healpix-zarr/` package | Task 1 |
| `HealpixTileset2D extends Tileset2D` | Task 5 |
| `HealpixZarrTileLayer extends TileLayer` | Task 6 |
| `CachedZarrStore` LRU + dedup | Task 4 |
| `clampToAvailable`, `getNsideForZoom` | Task 3 |
| `rowRangeFromOffsetPair` | Task 3 |
| Types: `HealpixTileIndex`, `HealpixZarrTileData` | Task 2 |
| Public exports + build | Task 7 |
| README with zarr format spec | Task 8 |
| `getTileIndices` returns `[]` before metadata | Task 5 test |
| `getParentIndex` uses `Math.floor(x/4)` | Task 5 |
| `zoomOffset` prop (default 5) | Task 6 |
| Raw values pass-through to `HealpixCellsLayer` | Task 6 |
| No NaN filtering in tile load path | Task 6 (absent from code) |
| AbortSignal threading | Task 6 |

**No spec requirements without coverage.**