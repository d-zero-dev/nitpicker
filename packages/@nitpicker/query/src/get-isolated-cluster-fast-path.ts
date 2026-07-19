import type { GetIsolatedClusterOptions, IsolatedClusterDetail } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { getIsolatedCluster } from './get-isolated-cluster.js';
import { getViewerIsolatedCluster } from './get-viewer-isolated-cluster.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches isolated-cluster detail reads to `getViewerIsolatedCluster`
 * (the `viewer_isolated_components` read-model fast path) when the read
 * model is current, otherwise falls back to `getIsolatedCluster` (the
 * legacy live union-find path). `options` passes through unchanged to
 * whichever backend answers — both implement the same filter/sort/pagination
 * contract, so the choice is purely "is the read model current or not".
 * @param accessor - The archive accessor to query.
 * @param representativeUrl - The cluster's representative URL, as returned
 *   by `listIsolatedClustersFastPath` / `listViewerIsolatedClusters`.
 * @param options - Member filter, sort, and pagination options.
 * @returns The cluster detail from whichever backend is currently valid, or
 *   `null` when no cluster matches `representativeUrl`.
 * @example
 * // Callers never need to check isViewerReadModelCurrent themselves:
 * const cluster = await getIsolatedClusterFastPath(
 *   accessor,
 *   'https://example.com/orphan/',
 *   { limit: 50 },
 * );
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
