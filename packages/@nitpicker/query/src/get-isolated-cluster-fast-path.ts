import type { GetIsolatedClusterOptions, IsolatedClusterDetail } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { getIsolatedCluster } from './get-isolated-cluster.js';
import { getViewerIsolatedCluster } from './get-viewer-isolated-cluster.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches isolated-cluster detail reads to the read model when current,
 * otherwise falls back to the legacy union-find path.
 * @param accessor
 * @param representativeUrl
 * @param options
 */
export async function getIsolatedClusterFastPath(
	accessor: ArchiveAccessor,
	representativeUrl: string,
	options: GetIsolatedClusterOptions = {},
): Promise<IsolatedClusterDetail | null> {
	return (await isViewerReadModelCurrent(accessor))
		? getViewerIsolatedCluster(accessor, representativeUrl, options)
		: getIsolatedCluster(accessor, representativeUrl, options);
}
