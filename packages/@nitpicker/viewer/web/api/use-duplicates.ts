import type { ViewerDuplicateGroupEntry } from '@nitpicker/query';

import { usePagedQuery } from './use-paged-query.js';

/** Field to check for duplicate values. */
export type DuplicateField = 'title' | 'description';

/**
 * Fetches duplicate-value groups for one metadata field via `/api/duplicates`
 * (issue #115's `viewer_duplicate_groups` read model). Each group's `pages`
 * is a bounded sample (`pagesLimit`, default 20) — `count` is the group's
 * true total member count, which can exceed `pages.length`.
 * @param field - The metadata field to check.
 * @returns The TanStack Query result for the duplicate groups.
 */
export function useDuplicates(field: DuplicateField) {
	return usePagedQuery<ViewerDuplicateGroupEntry>('/api/duplicates', { field }, [
		'duplicates',
		field,
	]);
}
