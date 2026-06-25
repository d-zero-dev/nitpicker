import type { ArchiveContext } from './types.js';
import type { IsolatedComponent } from '@nitpicker/query';

import { computeIsolatedClusters } from '@nitpicker/query';

import { createPromiseLru } from './promise-lru.js';

/**
 * Maximum number of archive IDs to keep cached `IsolatedComponent[]`
 * results for. The viewer normally holds one archive open at a time, so
 * a budget of four covers ordinary re-open / swap workflows without the
 * cache unboundedly accumulating across a long-running session.
 */
const MAX_ENTRIES = 4;

/**
 * Shared LRU of `computeIsolatedClusters` promises keyed by `archiveId`.
 * Delegates the dedup / promote-on-read / reject-eviction discipline to
 * the generic `createPromiseLru` helper so both this module and the
 * referrer-count cache share one tested core.
 */
const lru = createPromiseLru<string, IsolatedComponent[]>({ maxEntries: MAX_ENTRIES });

/**
 * Return the (cached) `computeIsolatedClusters` result for an archive,
 * computing it on first request and reusing it on subsequent ones.
 *
 * The three isolated-* viewer endpoints (`/api/isolated-pages`,
 * `/api/isolated-clusters`, `/api/isolated-clusters/:representativeUrl`)
 * all consume the same `IsolatedComponent[]`. Without this cache, each
 * endpoint pays the full union-find cost separately — measured at
 * ~20-30 s per call on a 10 GB inventory archive. With the cache, only
 * the first call pays it; every other endpoint hit on the same archive
 * resolves in single-digit milliseconds.
 *
 * **Stub-mode bypass.** When the viewer is attached to an in-progress
 * crawl (`mode === 'stub'`), the underlying archive is mutating: new
 * pages and anchors land continuously. Serving a snapshot from cache
 * would freeze isolation results at first hit and disagree with what
 * the live crawl reports. In stub mode we therefore recompute on every
 * request — slow (~20-30 s per click), but the only correct option
 * short of a change-feed invalidation mechanism the SQLite layer does
 * not expose.
 *
 * Read-only — safe against stub-mode archives. The cache is keyed by
 * the manager-issued `archiveId`, which the viewer's `ArchiveContext`
 * carries for the lifetime of the opened archive.
 * @param context - The viewer's per-request archive context.
 * @returns A promise that resolves to the (cached, except in stub
 *   mode) components.
 */
export async function getCachedIsolatedClusters(
	context: ArchiveContext,
): Promise<IsolatedComponent[]> {
	const accessor = context.manager.get(context.archiveId);
	if (context.mode === 'stub') {
		// Live crawl — recompute every time so the user sees updates.
		return computeIsolatedClusters(accessor);
	}
	return lru.getOrLoad(context.archiveId, () => computeIsolatedClusters(accessor));
}
