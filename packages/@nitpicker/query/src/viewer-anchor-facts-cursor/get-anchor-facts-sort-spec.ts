import type { AnchorFactsSortSpec } from './types.js';

/**
 * Resolves the keyset sort plan for a `sortBy`/`sortOrder` pair.
 * @param sortBy - The field to sort by.
 * @param sortOrder - The sort direction.
 * @returns The resolved {@link AnchorFactsSortSpec}.
 */
export function getAnchorFactsSortSpec(
	sortBy: 'sourceUrl' | 'destUrl' | 'status',
	sortOrder: 'asc' | 'desc',
): AnchorFactsSortSpec {
	switch (sortBy) {
		case 'status': {
			return {
				columns: [
					sortOrder === 'desc' ? 'status_desc_key' : 'status_sort_key',
					'source_url_ref_id',
					'edge_id',
				],
				scanDirection: 'asc',
			};
		}
		case 'destUrl': {
			return { columns: ['dest_url_ref_id', 'edge_id'], scanDirection: sortOrder };
		}
		default: {
			return { columns: ['source_url_ref_id', 'edge_id'], scanDirection: sortOrder };
		}
	}
}
