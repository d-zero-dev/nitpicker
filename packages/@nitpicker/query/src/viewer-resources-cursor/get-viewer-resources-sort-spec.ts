import type { ViewerResourcesSortSpec } from './types.js';

/**
 * Resolves the keyset sort plan for a `/api/resources` `sortBy`/`sortOrder`
 * pair.
 * @param sortBy - The field to sort by.
 * @param sortOrder - The sort direction.
 * @returns The resolved {@link ViewerResourcesSortSpec}.
 */
export function getViewerResourcesSortSpec(
	sortBy: 'url' | 'status',
	sortOrder: 'asc' | 'desc',
): ViewerResourcesSortSpec {
	if (sortBy === 'status') {
		return {
			columns: [
				sortOrder === 'desc' ? 'status_desc_key' : 'status_sort_key',
				'url_sort_key',
				'resource_id',
			],
			scanDirection: 'asc',
		};
	}
	return { columns: ['url_sort_key', 'resource_id'], scanDirection: sortOrder };
}
