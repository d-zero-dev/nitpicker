import type {
	IsolatedClusterSummary,
	ListViewerIsolatedClustersOptions,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { listIsolatedClusters } from './list-isolated-clusters.js';
import { listViewerIsolatedClusters } from './list-viewer-isolated-clusters.js';
import { resolveLegacyFilterValue } from './resolve-legacy-filter-value.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches `/api/isolated-clusters` reads to the read model when current,
 * otherwise falls back to the legacy union-find path. Takes {@link
 * ListViewerIsolatedClustersOptions} (fast-path shape, `status` array-
 * capable): the legacy `listIsolatedClusters` still filters `status` by
 * strict equality, so a multi-select `status` is narrowed to its first
 * element via `resolveLegacyFilterValue` on that branch — multi-select
 * degrades to single-select on a stale/absent read model rather than
 * matching nothing.
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options.
 * @returns Matching cluster summaries plus the total matching count.
 * @example
 * // Callers never need to know which path served the read:
 * const { items, total } = await listIsolatedClustersFastPath(accessor, { limit: 50 });
 */
export async function listIsolatedClustersFastPath(
	accessor: ArchiveAccessor,
	options: ListViewerIsolatedClustersOptions = {},
): Promise<{ items: IsolatedClusterSummary[]; total: number }> {
	return (await isViewerReadModelCurrent(accessor))
		? listViewerIsolatedClusters(accessor, options)
		: listIsolatedClusters(accessor, {
				...options,
				status: resolveLegacyFilterValue(options.status),
			});
}
