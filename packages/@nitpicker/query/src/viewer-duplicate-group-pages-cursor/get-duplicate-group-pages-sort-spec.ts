import type { DuplicateGroupPagesSortSpec } from './types.js';

/**
 * Resolves the keyset sort plan for `viewer_duplicate_group_pages`. There is
 * only one supported order (`url_sort_key` ascending, tie-broken by
 * `page_id`) — see {@link DuplicateGroupPagesSortSpec}'s docs for why no
 * `sortOrder` parameter is needed.
 * @returns The fixed {@link DuplicateGroupPagesSortSpec}.
 */
export function getDuplicateGroupPagesSortSpec(): DuplicateGroupPagesSortSpec {
	return { columns: ['url_sort_key', 'page_id'], scanDirection: 'asc' };
}
