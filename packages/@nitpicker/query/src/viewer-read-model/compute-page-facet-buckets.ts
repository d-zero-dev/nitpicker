import type { FacetBucketRow, FacetSourceRow } from './types.js';

import { classifyContentType } from '../classify-content-type.js';

/**
 * Content-type categories folded into the synthetic `'default'` facet scope
 * — the same `'html'` ∪ `'unknown'` view `applyViewerPagesFilters` resolves
 * to when `contentTypeCategory` is omitted.
 */
const DEFAULT_FACET_CATEGORIES = new Set(['html', 'unknown']);

/** One of the three dimensions tallied per content-type category. */
type FacetDimension = 'is_external' | 'lang' | 'status';

/**
 * Tallies distinct `status` / `lang` / `is_external` values per content-type
 * category (plus the synthetic `'default'` category), so `/api/pages`'s
 * dynamic filter dropdowns can be served from a single indexed
 * `viewer_count_buckets` lookup instead of a per-request `DISTINCT` scan over
 * `pages` — see `getPageListFacets` in `list-pages.ts` for the live
 * live-scan counterpart this precomputation replaces on the `viewer_pages`
 * fast path.
 *
 * Pure and synchronous — takes the same in-memory row array
 * `buildViewerReadModel` already holds before chunked-inserting
 * `viewer_pages`, so this adds no extra database round-trip.
 * @param rows - Every row that will become a `viewer_pages` entry (i.e. the
 *   `pages` rows already filtered to `scraped = 1 AND redirectDestId IS
 *   NULL` and non-skipped).
 * @returns One `viewer_count_buckets` row per distinct
 *   `(category, dimension, value)` combination observed.
 */
export function computePageFacetBuckets(
	rows: readonly FacetSourceRow[],
): FacetBucketRow[] {
	const tallies = new Map<string, Map<FacetDimension, Map<string, number>>>();

	const tally = (category: string, dimension: FacetDimension, value: string): void => {
		let byDimension = tallies.get(category);
		if (!byDimension) {
			byDimension = new Map();
			tallies.set(category, byDimension);
		}
		let byValue = byDimension.get(dimension);
		if (!byValue) {
			byValue = new Map();
			byDimension.set(dimension, byValue);
		}
		byValue.set(value, (byValue.get(value) ?? 0) + 1);
	};

	for (const row of rows) {
		const category = classifyContentType(row.contentType);
		const categories = DEFAULT_FACET_CATEGORIES.has(category)
			? [category, 'default']
			: [category];
		for (const cat of categories) {
			if (row.status != null) {
				tally(cat, 'status', String(row.status));
			}
			// Null-or-empty both mean "no lang facet" here, matching this
			// module's own has_title/has_description/has_og_title idiom —
			// deliberately stricter than live `getPageListFacets`'s
			// `isPresent` (`!= null` only), which would otherwise surface an
			// unlabeled blank radio option for `<html lang="">` rows.
			if (row.lang != null && row.lang !== '') {
				tally(cat, 'lang', row.lang);
			}
			tally(cat, 'is_external', row.isExternal ? '1' : '0');
		}
	}

	const buckets: FacetBucketRow[] = [];
	for (const [category, byDimension] of tallies) {
		for (const [dimension, byValue] of byDimension) {
			for (const [value, count] of byValue) {
				buckets.push({
					scope: 'pages',
					key: `facet:${dimension}:content_category=${category}`,
					value,
					count,
				});
			}
		}
	}
	return buckets;
}
