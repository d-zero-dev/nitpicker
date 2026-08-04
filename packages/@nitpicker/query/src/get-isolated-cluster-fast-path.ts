import type { GetViewerIsolatedClusterOptions, IsolatedClusterDetail } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { getIsolatedCluster } from './get-isolated-cluster.js';
import { getViewerIsolatedCluster } from './get-viewer-isolated-cluster.js';
import { resolveLiveFilterValue } from './resolve-live-filter-value.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches isolated-cluster detail reads to `getViewerIsolatedCluster`
 * (the `viewer_isolated_components` read-model fast path) when the read
 * model is current, otherwise falls back to `getIsolatedCluster` (the
 * live union-find path). Takes {@link GetViewerIsolatedClusterOptions}
 * (fast-path shape, `status`/`source` array-capable): the live
 * `getIsolatedCluster` still filters both by strict equality, so a
 * multi-select value is narrowed to its first element via
 * `resolveLiveFilterValue` on that branch — multi-select degrades to
 * single-select on a stale/absent read model rather than matching nothing.
 * @param accessor - The archive accessor to query.
 * @param representativeUrl - The cluster's representative URL, as returned
 *   by `listIsolatedClustersFastPath` / `listViewerIsolatedClusters`.
 * @param options - Member filter, sort, and pagination options.
 * @param precheckedReadModelCurrent - The caller's own already-computed
 *   `isViewerReadModelCurrent` result, when it has one — avoids probing the
 *   same tables a second time per request. Omit to let this function check.
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
	options: GetViewerIsolatedClusterOptions = {},
	precheckedReadModelCurrent?: boolean,
): Promise<IsolatedClusterDetail | null> {
	return (precheckedReadModelCurrent ?? (await isViewerReadModelCurrent(accessor)))
		? getViewerIsolatedCluster(accessor, representativeUrl, options)
		: getIsolatedCluster(accessor, representativeUrl, {
				...options,
				status: resolveLiveFilterValue(options.status),
				source: resolveLiveFilterValue(options.source),
			});
}
