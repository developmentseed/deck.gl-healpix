import { describe, it, expect, beforeEach } from '@jest/globals';
import { CachedZarrStore, type FetchStoreLike } from './cached-zarr-store.js';

type AbsolutePath = `/${string}`;

const BYTES = new Uint8Array([1, 2, 3]);

function makeBaseStore(
  getImpl: (key: AbsolutePath) => Promise<Uint8Array | undefined> = () => Promise.resolve(BYTES),
  getRangeImpl: () => Promise<Uint8Array | undefined> = () => Promise.resolve(BYTES)
): FetchStoreLike & { getCalls: AbsolutePath[]; getRangeCalls: number } {
  const getCalls: AbsolutePath[] = [];
  let getRangeCalls = 0;
  return {
    getCalls,
    get getRangeCalls() {
      return getRangeCalls;
    },
    async get(key: AbsolutePath) {
      getCalls.push(key);
      return getImpl(key);
    },
    async getRange(_key: AbsolutePath, _range: unknown) {
      getRangeCalls++;
      return getRangeImpl();
    },
  };
}

function makeStore(
  base: FetchStoreLike,
  opts: { maxCacheEntries?: number } = {}
): CachedZarrStore {
  return new CachedZarrStore('http://example.com', { _baseStore: base, ...opts });
}

describe('CachedZarrStore.get', () => {
  it('fetches and returns data on first call', async () => {
    const base = makeBaseStore();
    const store = makeStore(base);

    const result = await store.get('/foo');

    expect(result).toBe(BYTES);
    expect(base.getCalls).toHaveLength(1);
  });

  it('returns cached result on second call without fetching again', async () => {
    const base = makeBaseStore();
    const store = makeStore(base);

    await store.get('/foo');
    const result = await store.get('/foo');

    expect(result).toBe(BYTES);
    expect(base.getCalls).toHaveLength(1);
    expect(store.stats.cacheHits).toBe(1);
  });

  it('deduplicates concurrent requests for the same key', async () => {
    let resolve!: (v: Uint8Array) => void;
    const base = makeBaseStore(() => new Promise<Uint8Array>((r) => (resolve = r)));
    const store = makeStore(base);

    const p1 = store.get('/bar');
    const p2 = store.get('/bar');

    resolve(BYTES);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe(BYTES);
    expect(r2).toBe(BYTES);
    expect(base.getCalls).toHaveLength(1);
    expect(store.stats.deduped).toBe(1);
  });

  it('caches undefined (missing key) to avoid re-fetching', async () => {
    const base = makeBaseStore(() => Promise.resolve(undefined));
    const store = makeStore(base);

    await store.get('/missing');
    await store.get('/missing');

    expect(base.getCalls).toHaveLength(1);
    expect(store.stats.cacheHits).toBe(1);
  });

  it('uses separate cache entries for different keys', async () => {
    const base = makeBaseStore();
    const store = makeStore(base);

    await store.get('/a');
    await store.get('/b');

    expect(base.getCalls).toHaveLength(2);
    expect(store.stats.fetches).toBe(2);
  });
});

describe('CachedZarrStore.getRange', () => {
  it('fetches and caches range requests', async () => {
    const base = makeBaseStore();
    const store = makeStore(base);

    const range = { offset: 0, length: 16 };
    const r1 = await store.getRange('/foo', range);
    const r2 = await store.getRange('/foo', range);

    expect(r1).toBe(BYTES);
    expect(r2).toBe(BYTES);
    expect(base.getRangeCalls).toBe(1);
    expect(store.stats.cacheHits).toBe(1);
  });

  it('uses different cache keys for different ranges', async () => {
    const base = makeBaseStore();
    const store = makeStore(base);

    await store.getRange('/foo', { offset: 0, length: 16 });
    await store.getRange('/foo', { offset: 16, length: 16 });

    expect(base.getRangeCalls).toBe(2);
  });
});

describe('CachedZarrStore stats', () => {
  let base: ReturnType<typeof makeBaseStore>;

  beforeEach(() => {
    base = makeBaseStore();
  });

  it('tracks requests, fetches, cacheHits correctly', async () => {
    const store = makeStore(base);

    await store.get('/a');
    await store.get('/a');
    await store.get('/b');

    expect(store.stats.requests).toBe(3);
    expect(store.stats.fetches).toBe(2);
    expect(store.stats.cacheHits).toBe(1);
    expect(store.stats.deduped).toBe(0);
  });

  it('resetStats zeroes all counters', async () => {
    const store = makeStore(base);
    await store.get('/a');

    store.resetStats();

    expect(store.stats).toEqual({ requests: 0, cacheHits: 0, deduped: 0, fetches: 0 });
  });
});

describe('CachedZarrStore cache management', () => {
  it('clearCache removes all cached entries', async () => {
    const store = makeStore(makeBaseStore());

    await store.get('/a');
    expect(store.cacheSize).toBe(1);

    store.clearCache();
    expect(store.cacheSize).toBe(0);
  });

  it('evicts oldest entry when maxCacheEntries is exceeded', async () => {
    const store = makeStore(makeBaseStore(), { maxCacheEntries: 2 });

    await store.get('/a');
    await store.get('/b');
    await store.get('/c'); // evicts /a

    expect(store.cacheSize).toBe(2);

    // /a was evicted, re-fetch costs another network call
    await store.get('/a');
    expect(store.stats.fetches).toBe(4);
  });
});
