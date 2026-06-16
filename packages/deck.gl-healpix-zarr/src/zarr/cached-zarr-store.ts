import * as zarr from 'zarrita';

type AbsolutePath = `/${string}`;
type RangeQuery = { offset: number; length: number } | { suffixLength: number };

export interface FetchStoreLike {
  get(
    key: AbsolutePath,
    options?: RequestInit
  ): Promise<Uint8Array | undefined>;
  getRange(
    key: AbsolutePath,
    range: RangeQuery,
    options?: RequestInit
  ): Promise<Uint8Array | undefined>;
}

function rangeKey(key: AbsolutePath, range: RangeQuery): string {
  if ('suffixLength' in range) return `${key}@suffix:${range.suffixLength}`;
  return `${key}@${range.offset}:${range.length}`;
}

export interface CachedStoreStats {
  requests: number;
  cacheHits: number;
  deduped: number;
  fetches: number;
}

/**
 * A zarrita-compatible store wrapping `FetchStore` with in-memory caching
 * and in-flight request deduplication.
 *
 * - **Cache:** Resolved results are kept in an LRU map so repeated reads
 *   never re-fetch.
 * - **Dedup:** Concurrent requests for the same key share one in-flight promise.
 * - **Stats:** `requests = cacheHits + deduped + fetches`.
 */
export class CachedZarrStore {
  url: string | URL;
  stats: CachedStoreStats = {
    requests: 0,
    cacheHits: 0,
    deduped: 0,
    fetches: 0
  };

  #base: FetchStoreLike;
  #cache: Map<string, Uint8Array | undefined>;
  #inflight: Map<string, Promise<Uint8Array | undefined>>;
  #maxEntries: number;

  constructor(
    url: string | URL,
    options: {
      overrides?: RequestInit;
      useSuffixRequest?: boolean;
      maxCacheEntries?: number;
      /** Override the underlying store — used for testing. */
      _baseStore?: FetchStoreLike;
    } = {}
  ) {
    this.url = url;
    this.#base = options._baseStore ?? new zarr.FetchStore(url, options);
    this.#cache = new Map();
    this.#inflight = new Map();
    this.#maxEntries = options.maxCacheEntries ?? 2048;
  }

  resetStats(): void {
    this.stats = { requests: 0, cacheHits: 0, deduped: 0, fetches: 0 };
  }

  clearCache(): void {
    this.#cache.clear();
    this.#inflight.clear();
  }

  get cacheSize(): number {
    return this.#cache.size;
  }

  async get(
    key: AbsolutePath,
    options?: RequestInit
  ): Promise<Uint8Array | undefined> {
    this.stats.requests++;
    return this.#resolve(key, () => {
      this.stats.fetches++;
      return this.#base.get(key, options);
    });
  }

  async getRange(
    key: AbsolutePath,
    range: RangeQuery,
    options?: RequestInit
  ): Promise<Uint8Array | undefined> {
    this.stats.requests++;
    return this.#resolve(rangeKey(key, range), () => {
      this.stats.fetches++;
      return this.#base.getRange(key, range, options);
    });
  }

  #resolve(
    cacheKey: string,
    fetchFn: () => Promise<Uint8Array | undefined>
  ): Promise<Uint8Array | undefined> {
    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined || this.#cache.has(cacheKey)) {
      this.stats.cacheHits++;
      return Promise.resolve(cached);
    }

    const inflight = this.#inflight.get(cacheKey);
    if (inflight) {
      this.stats.deduped++;
      return inflight;
    }

    const promise = fetchFn().then(
      (result) => {
        this.#inflight.delete(cacheKey);
        this.#evictIfNeeded();
        this.#cache.set(cacheKey, result);
        return result;
      },
      (error: unknown) => {
        this.#inflight.delete(cacheKey);
        throw error;
      }
    );

    this.#inflight.set(cacheKey, promise);
    return promise;
  }

  #evictIfNeeded(): void {
    if (this.#cache.size < this.#maxEntries) return;
    const first = this.#cache.keys().next().value;
    if (first !== undefined) this.#cache.delete(first);
  }
}
