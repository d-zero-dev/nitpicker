import type { ViewerUnusedResourcesSortSpec } from './types.js';

/**
 * Resolves the keyset sort plan for a `/api/unused-resources`
 * `sortBy`/`sortOrder` pair.
 * @param sortBy - The field to sort by.
 * @param sortOrder - The sort direction.
 * @returns The resolved {@link ViewerUnusedResourcesSortSpec}.
 */
export function getViewerUnusedResourcesSortSpec(
	sortBy: 'url' | 'status' | 'source' | 'contentType' | 'contentLength',
	sortOrder: 'asc' | 'desc',
): ViewerUnusedResourcesSortSpec {
	switch (sortBy) {
		case 'status': {
			return {
				columns: [
					sortOrder === 'desc' ? 'status_desc_key' : 'status_sort_key',
					'url_sort_key',
					'resource_id',
				],
				scanDirection: 'asc',
			};
		}
		case 'source': {
			return {
				columns: ['source', 'url_sort_key', 'resource_id'],
				scanDirection: sortOrder,
			};
		}
		case 'contentType': {
			return {
				columns: ['content_type_raw', 'url_sort_key', 'resource_id'],
				scanDirection: sortOrder,
			};
		}
		case 'contentLength': {
			return {
				columns: ['content_length', 'url_sort_key', 'resource_id'],
				scanDirection: sortOrder,
			};
		}
		default: {
			return { columns: ['url_sort_key', 'resource_id'], scanDirection: sortOrder };
		}
	}
}
