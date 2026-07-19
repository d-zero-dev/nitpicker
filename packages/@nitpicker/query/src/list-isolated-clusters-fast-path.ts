import type { IsolatedClusterSummary, ListIsolatedClustersOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { listIsolatedClusters } from './list-isolated-clusters.js';
import { listViewerIsolatedClusters } from './list-viewer-isolated-clusters.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches `/api/isolated-clusters` reads to the read model when current,
 * otherwise falls back to the legacy union-find path.
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options (shared by both paths).
 * @returns Matching cluster summaries plus the total matching count.
 * @example
 * // Callers never need to know which path served the read:
 * const { items, total } = await listIsolatedClustersFastPath(accessor, { limit: 50 });
 */
export async function listIsolatedClustersFastPath(
	accessor: ArchiveAccessor,
	options: ListIsolatedClustersOptions = {},
): Promise<{ items: IsolatedClusterSummary[]; total: number }> {
	return (await isViewerReadModelCurrent(accessor))
		? listViewerIsolatedClusters(accessor, options)
		: listIsolatedClusters(accessor, options);
}
