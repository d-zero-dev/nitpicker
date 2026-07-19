import type { ContentTypeCategory, PageListFacets } from './types.js';
import type { Knex } from 'knex';

/** Row shape read back from `viewer_count_buckets` for a facet lookup. */
interface FacetBucketValueRow {
	/** `facet:<dimension>:content_category=<category>` — see `computePageFacetBuckets`. */
	key: string;
	/** The stringified facet value. */
	value: string;
}

/**
 * Resolves the `viewer_count_buckets` category key for a facet lookup.
 * Kept as a dedicated function (not a `contentTypeCategory ?? 'default'`
 * default-parameter expression) so the literal `'default'` sentinel stays an
 * internal implementation detail of `computePageFacetBuckets`'s bucket-key
 * format, never part of {@link readViewerPageFacets}'s public parameter type.
 * @param contentTypeCategory - The caller's active category filter, or
 *   `undefined` when omitted.
 * @returns The resolved category key.
 */
function resolveFacetCategoryKey(
	contentTypeCategory: ContentTypeCategory | undefined,
): string {
	if (contentTypeCategory === undefined) {
		return 'default';
	}
	return contentTypeCategory;
}

/**
 * Resolves the precomputed dynamic filter enum candidates (status / lang /
 * is_external) for `/api/pages`'s `viewer_pages` fast path, from the
 * `viewer_count_buckets` rows `computePageFacetBuckets` wrote at build time.
 *
 * Mirrors `getPageListFacets` (the legacy `listPages` live-`DISTINCT`
 * counterpart in `list-pages.ts`) in scope and result sort order, but never
 * scans `pages` — every value here is a plain lookup against
 * `viewer_count_buckets`'s `(scope, key, value)` primary key, so this stays
 * inside the 100ms contract regardless of archive size.
 * @param knex - The archive's Knex instance.
 * @param contentTypeCategory - The caller's active category filter, or
 *   `undefined` to resolve the same `'html'` ∪ `'unknown'` default view
 *   `applyViewerPagesFilters` itself filters to when the option is omitted.
 * @returns The facet candidates for the resolved category scope.
 */
export async function readViewerPageFacets(
	knex: Knex,
	contentTypeCategory?: ContentTypeCategory,
): Promise<PageListFacets> {
	const categoryKey = resolveFacetCategoryKey(contentTypeCategory);
	const rows = await knex('viewer_count_buckets')
		.where('scope', 'pages')
		.whereIn('key', [
			`facet:status:content_category=${categoryKey}`,
			`facet:lang:content_category=${categoryKey}`,
			`facet:is_external:content_category=${categoryKey}`,
		])
		.select<FacetBucketValueRow[]>('key', 'value');

	const statuses: number[] = [];
	const langs: string[] = [];
	const types: boolean[] = [];
	for (const row of rows) {
		if (row.key.startsWith('facet:status:')) {
			statuses.push(Number(row.value));
		} else if (row.key.startsWith('facet:lang:')) {
			langs.push(row.value);
		} else {
			types.push(row.value === '1');
		}
	}

	return {
		statuses: statuses.toSorted((a, b) => a - b),
		langs: langs.toSorted((a, b) => a.localeCompare(b)),
		types: types.toSorted((a, b) => Number(a) - Number(b)),
	};
}
