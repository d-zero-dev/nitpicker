import type { IsolatedPageEntry, ListIsolatedPagesOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { listIsolatedPages } from './list-isolated-pages.js';
import { listViewerIsolatedPages } from './list-viewer-isolated-pages.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches `/api/isolated-pages` reads to the read model when current,
 * otherwise falls back to the legacy union-find path.
 * @param accessor
 * @param options
 */
export async function listIsolatedPagesFastPath(
	accessor: ArchiveAccessor,
	options: ListIsolatedPagesOptions = {},
): Promise<{ items: IsolatedPageEntry[]; total: number }> {
	return (await isViewerReadModelCurrent(accessor))
		? listViewerIsolatedPages(accessor, options)
		: listIsolatedPages(accessor, options);
}
