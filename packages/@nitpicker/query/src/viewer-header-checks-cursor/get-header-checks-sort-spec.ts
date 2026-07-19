import type { HeaderChecksSortSpec } from './types.js';

/**
 * Resolves the keyset sort plan for `viewer_header_checks`. There is only
 * one supported order (`url_sort_key`, tie-broken by `page_id`) — see
 * {@link HeaderChecksSortSpec}'s docs for why no `sortBy` switch is needed.
 * @param sortOrder - The sort direction.
 * @returns The resolved {@link HeaderChecksSortSpec}.
 */
export function getHeaderChecksSortSpec(sortOrder: 'asc' | 'desc'): HeaderChecksSortSpec {
	return { columns: ['url_sort_key', 'page_id'], scanDirection: sortOrder };
}
