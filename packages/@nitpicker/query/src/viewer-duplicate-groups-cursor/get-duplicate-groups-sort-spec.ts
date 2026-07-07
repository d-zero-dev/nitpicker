import type { DuplicateGroupsSortSpec } from './types.js';

/**
 * Resolves the keyset sort plan for `viewer_duplicate_groups`. There is only
 * one supported order (`count_desc_key` ascending == `count` descending,
 * tie-broken by `group_id`) — see {@link DuplicateGroupsSortSpec}'s docs for
 * why no `sortOrder` parameter is needed (legacy `findDuplicates` has no
 * `sortOrder` concept to mirror).
 * @returns The fixed {@link DuplicateGroupsSortSpec}.
 */
export function getDuplicateGroupsSortSpec(): DuplicateGroupsSortSpec {
	return { columns: ['count_desc_key', 'group_id'], scanDirection: 'asc' };
}
