import type { IsolatedPageEntry, ListViewerIsolatedPagesOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { listIsolatedPages } from './list-isolated-pages.js';
import { listViewerIsolatedPages } from './list-viewer-isolated-pages.js';
import { resolveLiveFilterValue } from './resolve-live-filter-value.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches `/api/isolated-pages` reads to the read model when current,
 * otherwise falls back to the live union-find path. Takes {@link
 * ListViewerIsolatedPagesOptions} (fast-path shape, `status`/`source`
 * array-capable): the live `listIsolatedPages` still filters both by
 * strict equality, so a multi-select value is narrowed to its first element
 * via `resolveLiveFilterValue` on that branch — multi-select degrades to
 * single-select on a stale/absent read model rather than matching nothing.
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options.
 * @returns Matching isolated-page rows plus the total matching count.
 * @example
 * // Callers never need to know which path served the read:
 * const { items, total } = await listIsolatedPagesFastPath(accessor, { limit: 50 });
 */
export async function listIsolatedPagesFastPath(
	accessor: ArchiveAccessor,
	options: ListViewerIsolatedPagesOptions = {},
): Promise<{ items: IsolatedPageEntry[]; total: number }> {
	return (await isViewerReadModelCurrent(accessor))
		? listViewerIsolatedPages(accessor, options)
		: listIsolatedPages(accessor, {
				...options,
				status: resolveLiveFilterValue(options.status),
				source: resolveLiveFilterValue(options.source),
			});
}
