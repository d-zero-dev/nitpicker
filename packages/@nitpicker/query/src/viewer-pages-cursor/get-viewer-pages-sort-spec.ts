import type { ViewerPagesSortSpec } from './types.js';

/**
 * Resolves the keyset sort plan for a `sortBy`/`sortOrder` pair.
 * @param sortBy - The field to sort by.
 * @param sortOrder - The sort direction.
 * @returns The resolved {@link ViewerPagesSortSpec}.
 */
export function getViewerPagesSortSpec(
	sortBy: 'url' | 'status' | 'title',
	sortOrder: 'asc' | 'desc',
): ViewerPagesSortSpec {
	switch (sortBy) {
		case 'status': {
			return {
				columns: [
					sortOrder === 'desc' ? 'status_desc_key' : 'status_sort_key',
					'url_sort_key',
					'page_id',
				],
				scanDirection: 'asc',
			};
		}
		case 'title': {
			return {
				columns: ['title_sort_key', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		default: {
			return { columns: ['natural_url_rank', 'page_id'], scanDirection: sortOrder };
		}
	}
}
