import type { ViewerResourcesSortColumn, ViewerResourcesSortSpec } from './types.js';

/**
 * The `sortBy` values `/api/resources`'s fast path accepts — the full
 * `ListResourcesOptions.sortBy` surface.
 */
export type ViewerResourcesSortBy =
	| 'url'
	| 'status'
	| 'statusText'
	| 'contentType'
	| 'contentLength'
	| 'isExternal'
	| 'referrerCount'
	| 'compress'
	| 'cdn';

/**
 * Maps each single-column `sortBy` to its `viewer_resources` column. `url`/
 * `status` are handled separately (they have dedicated tie-breaker shapes).
 */
const SIMPLE_SORT_COLUMN: Partial<
	Record<ViewerResourcesSortBy, ViewerResourcesSortColumn>
> = {
	statusText: 'status_text',
	contentType: 'content_type_raw',
	contentLength: 'content_length',
	isExternal: 'is_external',
	referrerCount: 'referrer_count',
	compress: 'compress',
	cdn: 'cdn',
};

/**
 * Resolves the keyset sort plan for a `/api/resources` `sortBy`/`sortOrder`
 * pair. Every tuple ends in `resource_id`, the stable tie-breaker; the
 * non-`url` sorts carry a `url_sort_key` secondary so equal-value runs stay
 * in URL order.
 * @param sortBy - The field to sort by.
 * @param sortOrder - The sort direction.
 * @returns The resolved {@link ViewerResourcesSortSpec}.
 */
export function getViewerResourcesSortSpec(
	sortBy: ViewerResourcesSortBy,
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
	const simpleColumn = SIMPLE_SORT_COLUMN[sortBy];
	if (simpleColumn) {
		// Plain scanDirection reversal (ties reverse along with the primary
		// in desc) — the same accepted trade `viewer_anchor_facts`'s
		// destUrl/sourceUrl/isExternal sorts make, reserving the negated-key
		// trick for `status` alone.
		return {
			columns: [simpleColumn, 'url_sort_key', 'resource_id'],
			scanDirection: sortOrder,
		};
	}
	return { columns: ['url_sort_key', 'resource_id'], scanDirection: sortOrder };
}
