import type { MismatchesSortSpec } from './types.js';

/**
 * Resolves the keyset sort plan for `viewer_mismatches`. There is only one
 * supported order (`url_sort_key`, tie-broken by `mismatch_id`) — see
 * {@link MismatchesSortSpec}'s docs for why no `sortBy` switch is needed.
 * @param sortOrder - The sort direction.
 * @returns The resolved {@link MismatchesSortSpec}.
 */
export function getMismatchesSortSpec(sortOrder: 'asc' | 'desc'): MismatchesSortSpec {
	return { columns: ['url_sort_key', 'mismatch_id'], scanDirection: sortOrder };
}
