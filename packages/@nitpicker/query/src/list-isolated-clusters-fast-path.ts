import type { IsolatedClusterSummary, ListIsolatedClustersOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { listIsolatedClusters } from './list-isolated-clusters.js';
import { listViewerIsolatedClusters } from './list-viewer-isolated-clusters.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches `/api/isolated-clusters` reads to the read model when current,
 * otherwise falls back to the legacy union-find path.
 * @param accessor
 * @param options
 */
export async function listIsolatedClustersFastPath(
	accessor: ArchiveAccessor,
	options: ListIsolatedClustersOptions = {},
): Promise<{ items: IsolatedClusterSummary[]; total: number }> {
	return (await isViewerReadModelCurrent(accessor))
		? listViewerIsolatedClusters(accessor, options)
		: listIsolatedClusters(accessor, options);
}
