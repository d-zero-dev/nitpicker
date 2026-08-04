import type { MismatchesEffectiveSortBy, MismatchesSortSpec } from './types.js';

/**
 * Resolves the keyset sort plan for `viewer_mismatches` from the effective
 * sort (see {@link MismatchesEffectiveSortBy} for the `'urlBinary'` vs
 * `'urlNatural'` split). Every tuple ends in `mismatch_id`, the stable
 * tie-breaker — for `'urlNatural'` it also disambiguates the shared-rank
 * duplicates a page failing several comparisons produces (see
 * `MismatchInsertRow.natural_url_rank`).
 *
 * `'actual'`/`'expected'` sort on nullable columns, but the keyset tuple is
 * still safe: a mismatch row by definition has non-null/non-empty values on
 * both sides at build time (`buildMismatchSourceQuery`'s
 * `whereNotNull`/`whereNot('', ...)` guards), so no `NULL` ever enters a
 * comparison tuple in practice — the same build-time-invariant reasoning
 * `viewer_mismatches`'s own DDL comment documents for the columns staying
 * nullable.
 * @param sortBy - The effective sort field.
 * @param sortOrder - The sort direction.
 * @returns The resolved {@link MismatchesSortSpec}.
 */
export function getMismatchesSortSpec(
	sortBy: MismatchesEffectiveSortBy,
	sortOrder: 'asc' | 'desc',
): MismatchesSortSpec {
	switch (sortBy) {
		case 'urlBinary': {
			return { columns: ['url_sort_key', 'mismatch_id'], scanDirection: sortOrder };
		}
		case 'urlNatural': {
			return { columns: ['natural_url_rank', 'mismatch_id'], scanDirection: sortOrder };
		}
		case 'actual': {
			return { columns: ['actual', 'mismatch_id'], scanDirection: sortOrder };
		}
		case 'expected': {
			return { columns: ['expected', 'mismatch_id'], scanDirection: sortOrder };
		}
	}
}
