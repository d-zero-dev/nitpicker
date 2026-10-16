import type { AliasCandidate } from '@nitpicker/core/types';

import { groupAliasCandidates as groupAliasCandidatesNative } from '@nitpicker/core/group-alias-candidates';

/**
 * Groups the pages that are the same page under another URL
 * (`content_items.alias_of_id`) and elects each group's representative: the
 * pages whose Tier A key (`computeTierAAliasKey`) and title match, or whose
 * Tier B key (`computeTierBAliasKey`), title and body hash match, and the
 * pages chained to them by either.
 *
 * `@nitpicker/query` reaches the native addon through this archive function
 * (see ARCHITECTURE.md's dependency rule); the full grouping and election rules
 * are the docs of `groupAliasCandidates` in `@nitpicker/core`, which this
 * calls as it is. The persisted result is pinned to the JavaScript reference by
 * `group-alias-candidates.parity.spec.ts` and `scripts/isolated-alias-golden.mjs`.
 * @param candidates - The pages. `urlId` is `url_refs.id`: two candidates
 *   have the same URL exactly when they have the same id.
 * @returns For each candidate, the index of its group's representative, or
 *   `-1` for a representative and for a candidate in a group of one.
 * @example
 * ```ts
 * const page = { titleTextId: 1, canonicalUrlId: null, bodyHash: null };
 * groupAliasCandidates([
 * 	{ ...page, url: 'https://example.com/about/index.html', urlId: 1 },
 * 	{ ...page, url: 'https://example.com/about/', urlId: 2 },
 * ]); // Int32Array [1, -1]
 * ```
 */
export function groupAliasCandidates(candidates: readonly AliasCandidate[]): Int32Array {
	return groupAliasCandidatesNative(candidates);
}
