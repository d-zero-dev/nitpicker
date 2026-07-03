/**
 * Options for {@link createPromiseLru}.
 */
export interface PromiseLruOptions {
	/**
	 * Maximum number of entries kept in the cache. Excess entries are
	 * evicted starting from the least-recently-used end. Must be ≥ 1.
	 */
	readonly maxEntries: number;
}

/**
 * The handle returned by {@link createPromiseLru}.
 * @template K - The cache key type.
 * @template V - The cached value type (always wrapped in a Promise).
 */
export interface PromiseLru<K, V> {
	/**
	 * Return the cached promise for `key`, or call `load` and cache its
	 * result if there is none. Concurrent callers receive the same
	 * in-flight promise. A rejected promise is dropped from the cache
	 * so the next caller retries from scratch (instead of being stuck
	 * on the cached error).
	 * @param key - Cache key (typically an `archiveId`).
	 * @param load - Loader invoked only on cache miss.
	 * @returns The cached or newly-loaded value.
	 */
	getOrLoad(key: K, load: () => Promise<V>): Promise<V>;
}

/**
 * Build a generic LRU cache of in-flight / settled Promises.
 *
 * Centralises the cache discipline that the viewer's
 * `isolated-clusters-cache` and `graph-cache` both want:
 *
 * - **In-flight dedup**: concurrent `getOrLoad(k, …)` calls with the
 *   same key share one underlying load.
 * - **Reject cleanup**: a rejected promise is removed from the cache
 *   so the next call retries cleanly. Done via identity comparison so
 *   a concurrent re-population by a different caller (different
 *   promise) is left alone.
 * - **True LRU**: every `get` of an existing entry promotes that key
 *   to the most-recent end by `delete` + re-`set`. Without this step
 *   `Map`'s insertion-order iteration degenerates to FIFO — a long-
 *   running viewer that keeps hitting one hot archive would evict
 *   the hot archive first because it was inserted first.
 * - **Bounded growth**: evicts oldest entries in a `while` loop after
 *   each insert so a burst that overshoots `maxEntries` by more than
 *   one still settles to the cap.
 *
 * Single-process only. No persistence, no manual invalidation hooks —
 * callers that need stub-mode-style live-data semantics gate at the
 * call site by skipping `getOrLoad` and computing directly.
 * @template K - Cache key type. `string` for `archiveId`-keyed caches.
 * @template V - Cached value type.
 * @param options - {@link PromiseLruOptions}.
 * @returns A {@link PromiseLru} handle.
 * @example
 * ```ts
 * const lru = createPromiseLru<string, IsolatedComponent[]>({ maxEntries: 4 });
 * const components = await lru.getOrLoad(archiveId, () => computeIsolatedClusters(accessor));
 * ```
 */
export function createPromiseLru<K, V>(options: PromiseLruOptions): PromiseLru<K, V> {
	if (options.maxEntries < 1) {
		throw new RangeError(`maxEntries must be >= 1 (received ${options.maxEntries})`);
	}
	const cache = new Map<K, Promise<V>>();

	return {
		getOrLoad(key, load) {
			const existing = cache.get(key);
			if (existing !== undefined) {
				// Promote on read so the next eviction picks the truly
				// coldest entry. `Map.set` of an existing key in V8 does
				// NOT reorder insertion-order, so we delete first.
				cache.delete(key);
				cache.set(key, existing);
				return existing;
			}
			const promise = load().catch((error: unknown) => {
				// Identity check: only evict if the cache still holds
				// THIS promise. A concurrent re-population is left alone.
				if (cache.get(key) === promise) {
					cache.delete(key);
				}
				throw error;
			});
			cache.set(key, promise);
			while (cache.size > options.maxEntries) {
				const oldest = cache.keys().next().value;
				if (oldest === undefined) {
					break;
				}
				cache.delete(oldest);
			}
			return promise;
		},
	};
}
