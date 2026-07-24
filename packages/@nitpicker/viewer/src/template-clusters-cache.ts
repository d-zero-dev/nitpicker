import type { ArchiveContext } from './types.js';
import type { TemplateClusterListResult } from '@nitpicker/query';

import { listPageTemplateClusters } from '@nitpicker/query';

import { createPromiseLru } from './promise-lru.js';

/**
 * Maximum number of archive IDs to keep cached `TemplateClusterListResult`
 * results for. Matches `isolated-clusters-cache.ts`'s budget — the viewer
 * normally holds one archive open at a time, so four covers ordinary
 * re-open / swap workflows without unbounded growth across a long session.
 */
const MAX_ENTRIES = 4;

/**
 * Shared LRU of `listPageTemplateClusters` promises keyed by `archiveId`.
 */
const lru = createPromiseLru<string, TemplateClusterListResult>({
	maxEntries: MAX_ENTRIES,
});

/**
 * Return the (cached) `listPageTemplateClusters` result for an archive,
 * computing it on first request and reusing it on subsequent ones.
 *
 * Unlike `isolated-clusters-cache.ts`, this does not also persist to the
 * on-disk cache: `listPageTemplateClusters` measured at ~1-2s on a
 * 486,000-page archive (see its own JSDoc for the JOIN-order pitfall that
 * keeps it in that range), which is cheap enough that a viewer restart
 * simply re-pays it once rather than needing cross-restart persistence.
 *
 * **Stub-mode bypass.** When the viewer is attached to an in-progress crawl
 * (`mode === 'stub'`), `page_templates` cannot change mid-crawl (classification
 * only runs as part of `analyze --templates`, a separate, already-finished
 * step from crawling) — but the archive's `content_items`/`resource_ref_edges`
 * rows a cached result was computed from can still shift as the crawl
 * continues to write. Recomputing on every request in stub mode keeps this
 * endpoint consistent with the same bypass every other stub-mode viewer
 * cache applies (see `isolated-clusters-cache.ts`, `summary-cache.ts`).
 * @param context - The viewer's per-request archive context.
 * @returns A promise that resolves to the (cached, except in stub mode) result.
 */
export async function getCachedTemplateClusters(
	context: ArchiveContext,
): Promise<TemplateClusterListResult> {
	const accessor = context.manager.get(context.archiveId);
	if (context.mode === 'stub') {
		return listPageTemplateClusters(accessor);
	}
	return lru.getOrLoad(context.archiveId, () => listPageTemplateClusters(accessor));
}
