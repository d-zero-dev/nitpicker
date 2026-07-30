import type { ArchiveContext } from './types.js';
import type {
	DuplicateBodyClusterEntry,
	ListDuplicateBodyClustersOptions,
} from '@nitpicker/query';

import { listDuplicateBodyClusters } from '@nitpicker/query';

import { createPromiseLru } from './promise-lru.js';

/**
 * Maximum number of (archiveId + params) cache keys to keep. Matches
 * `template-clusters-cache.ts`'s budget — the viewer normally holds one
 * archive open at a time, and a handful of distinct parameter combinations
 * (default view, plus maybe one or two `minCount` adjustments) fits well
 * within this.
 */
const MAX_ENTRIES = 4;

/**
 * Shared LRU of `listDuplicateBodyClusters` promises, keyed by `archiveId`
 * plus the resolved options (unlike `template-clusters-cache.ts`, this
 * function takes caller-adjustable parameters, so the archiveId alone is
 * not a valid cache key — two different `minCount` values for the same
 * archive must not share a cache slot).
 */
const lru = createPromiseLru<string, DuplicateBodyClusterEntry[]>({
	maxEntries: MAX_ENTRIES,
});

/**
 * Return the (cached) `listDuplicateBodyClusters` result for an archive +
 * options, computing it on first request and reusing it on subsequent ones.
 *
 * **Stub-mode bypass.** Same rationale as `template-clusters-cache.ts` /
 * `isolated-clusters-cache.ts` / `summary-cache.ts`: an in-progress crawl's
 * `content_items`/`page_meta` rows keep shifting, so a cached result would
 * go stale mid-crawl. Recompute on every request instead.
 * @param context - The viewer's per-request archive context.
 * @param options - See {@link ListDuplicateBodyClustersOptions}.
 * @returns A promise that resolves to the (cached, except in stub mode) result.
 */
export async function getCachedDuplicateBodyClusters(
	context: ArchiveContext,
	options: ListDuplicateBodyClustersOptions,
): Promise<DuplicateBodyClusterEntry[]> {
	const accessor = context.manager.get(context.archiveId);
	if (context.mode === 'stub') {
		return listDuplicateBodyClusters(accessor, options);
	}
	const cacheKey = `${context.archiveId}:${JSON.stringify(options)}`;
	return lru.getOrLoad(cacheKey, () => listDuplicateBodyClusters(accessor, options));
}
