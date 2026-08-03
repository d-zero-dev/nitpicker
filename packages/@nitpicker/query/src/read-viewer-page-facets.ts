import type { ContentTypeCategory, PageListFacets } from './types.js';
import type { Knex } from 'knex';

import { hasPageTemplatesTable } from './page-templates-join.js';

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
 * Mirrors `getPageListFacets` (`listPages`'s own live-`DISTINCT`
 * counterpart in `list-pages.ts`) in scope and result sort order, but never
 * scans `pages` — every value here is a plain lookup against
 * `viewer_count_buckets`'s `(scope, key, value)` primary key, so this stays
 * inside the 100ms contract regardless of archive size.
 *
 * `templateKeys` is the one exception: `page_templates` is populated at
 * `analyze --templates` time, entirely independent of the crawl-end/
 * viewer-build read-model pipeline that produces `viewer_count_buckets` (see
 * `hasPageTemplatesTable`'s doc), so there is no precomputed bucket to look
 * up. It reads a live `DISTINCT template_key` instead — acceptable because
 * `page_templates` is a narrow two-column `WITHOUT ROWID` table with no
 * joins, unlike the wide-table scans the `usesWideTableOnlyFilter` fallback
 * exists to avoid.
 * @param knex - The archive's Knex instance.
 * @param contentTypeCategory - The caller's active category filter, or
 *   `undefined` to resolve the same `'html'` ∪ `'unknown'` default view
 *   `applyViewerPagesFilters` itself filters to when the option is omitted.
 *   An array (multi-select OR) falls back to the `undefined`/default scope:
 *   `viewer_count_buckets` only precomputes one bucket per single category,
 *   not per arbitrary subset, so there is no exact bucket to look up for
 *   "any of these categories" — the candidates shown are then a superset
 *   (every category's values) rather than scoped to the selection, which is
 *   an acceptable approximation for a filter's own candidate list.
 * @returns The facet candidates for the resolved category scope.
 */
export async function readViewerPageFacets(
	knex: Knex,
	contentTypeCategory?: ContentTypeCategory | ContentTypeCategory[],
): Promise<PageListFacets> {
	const categoryKey = resolveFacetCategoryKey(
		Array.isArray(contentTypeCategory) ? undefined : contentTypeCategory,
	);
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

	const hasPageTemplates = await hasPageTemplatesTable(knex);
	const templateKeys = hasPageTemplates
		? (
				(await knex('page_templates').distinct('template_key')) as {
					template_key: string;
				}[]
			).map((row) => row.template_key)
		: [];

	return {
		statuses: statuses.toSorted((a, b) => a - b),
		langs: langs.toSorted((a, b) => a.localeCompare(b)),
		types: types.toSorted((a, b) => Number(a) - Number(b)),
		templateKeys: templateKeys.toSorted((a, b) => a.localeCompare(b)),
	};
}
