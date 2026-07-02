import { describe, expect, it } from 'vitest';

import { computePageFacetBuckets } from './compute-page-facet-buckets.js';

/**
 * Convenience factory for a facet source row, filling unset fields with defaults.
 * @param overrides
 */
function row(
	overrides: Partial<{
		status: number | null;
		contentType: string | null;
		isExternal: number | null;
		lang: string | null;
	}>,
): {
	status: number | null;
	contentType: string | null;
	isExternal: number | null;
	lang: string | null;
} {
	return {
		status: 200,
		contentType: 'text/html',
		isExternal: 0,
		lang: null,
		...overrides,
	};
}

/**
 * Looks up one bucket's count by its `(key, value)` pair, or `undefined` if
 * no row was produced for that combination.
 * @param buckets - The buckets returned by {@link computePageFacetBuckets}.
 * @param key - The bucket key to look up.
 * @param value - The bucket value to look up.
 * @returns The matching bucket's count, or `undefined`.
 */
function countFor(
	buckets: ReturnType<typeof computePageFacetBuckets>,
	key: string,
	value: string,
): number | undefined {
	return buckets.find((b) => b.key === key && b.value === value)?.count;
}

describe('computePageFacetBuckets', () => {
	it('returns an empty array for zero rows', () => {
		expect(computePageFacetBuckets([])).toEqual([]);
	});

	it('tallies status/lang/is_external per actual content_category', () => {
		const buckets = computePageFacetBuckets([
			row({ status: 200, lang: 'ja', isExternal: 0 }),
			row({ status: 200, lang: 'en', isExternal: 1 }),
			row({ status: 404, lang: 'ja', isExternal: 0 }),
		]);

		expect(countFor(buckets, 'facet:status:content_category=html', '200')).toBe(2);
		expect(countFor(buckets, 'facet:status:content_category=html', '404')).toBe(1);
		expect(countFor(buckets, 'facet:lang:content_category=html', 'ja')).toBe(2);
		expect(countFor(buckets, 'facet:lang:content_category=html', 'en')).toBe(1);
		expect(countFor(buckets, 'facet:is_external:content_category=html', '0')).toBe(2);
		expect(countFor(buckets, 'facet:is_external:content_category=html', '1')).toBe(1);
	});

	it('excludes null status and null/empty lang from their respective tallies', () => {
		const buckets = computePageFacetBuckets([
			row({ status: null, lang: null }),
			row({ status: null, lang: '' }),
		]);

		expect(buckets.some((b) => b.key.startsWith('facet:status:'))).toBe(false);
		expect(buckets.some((b) => b.key.startsWith('facet:lang:'))).toBe(false);
		// is_external is never conditionally excluded — null coerces to '0',
		// same as `toViewerPageInsertRow`'s `row.isExternal ? 1 : 0`.
		expect(countFor(buckets, 'facet:is_external:content_category=html', '0')).toBe(2);
	});

	it('folds html and unknown rows into the synthetic "default" category alongside their own category', () => {
		const buckets = computePageFacetBuckets([
			row({ contentType: 'text/html', status: 200 }),
			row({ contentType: null, status: 404 }),
		]);

		expect(countFor(buckets, 'facet:status:content_category=html', '200')).toBe(1);
		expect(countFor(buckets, 'facet:status:content_category=unknown', '404')).toBe(1);
		expect(countFor(buckets, 'facet:status:content_category=default', '200')).toBe(1);
		expect(countFor(buckets, 'facet:status:content_category=default', '404')).toBe(1);
	});

	it('does not fold a non-html/unknown category into the "default" scope', () => {
		const buckets = computePageFacetBuckets([row({ contentType: 'application/pdf' })]);

		expect(countFor(buckets, 'facet:status:content_category=pdf', '200')).toBe(1);
		expect(buckets.some((b) => b.key.includes('content_category=default'))).toBe(false);
	});
});
