import type { AnchorFactInsertRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { deriveExternalLinkSummaryRows } from './derive-external-link-summary-rows.js';

/**
 * Builds a minimal {@link AnchorFactInsertRow} with sensible defaults,
 * overridable per test.
 * @param overrides - Fields to override.
 * @returns The constructed row.
 */
function makeFact(overrides: Partial<AnchorFactInsertRow>): AnchorFactInsertRow {
	return {
		source_page_id: 1,
		dest_page_id: 100,
		source_url_sort_key: 'https://example.com/page',
		dest_url_sort_key: 'https://ads.example.com',
		status: 200,
		status_sort_key: 200,
		status_desc_key: -200,
		count: 1,
		is_broken: 0,
		is_external_link: 1,
		...overrides,
	};
}

describe('deriveExternalLinkSummaryRows', () => {
	it('returns an empty array when there are no external-link facts', () => {
		const facts = [makeFact({ is_external_link: 0 })];
		expect(deriveExternalLinkSummaryRows(facts)).toEqual([]);
	});

	it('excludes broken (non-external) facts from the summary', () => {
		const facts = [
			makeFact({ source_page_id: 1, is_external_link: 0, is_broken: 1 }),
			makeFact({ source_page_id: 2, is_external_link: 1 }),
		];
		expect(deriveExternalLinkSummaryRows(facts)).toEqual([
			{
				dest_page_id: 100,
				dest_url: 'https://ads.example.com',
				status: 200,
				referrer_count: 1,
			},
		]);
	});

	it('counts referrer_count as the number of distinct-source edge rows sharing a destination', () => {
		const facts = [
			makeFact({ source_page_id: 1 }),
			makeFact({ source_page_id: 2 }),
			makeFact({ source_page_id: 3 }),
		];
		const [summary] = deriveExternalLinkSummaryRows(facts);
		expect(summary).toMatchObject({ dest_page_id: 100, referrer_count: 3 });
	});

	it('does not inflate referrer_count using the edge-level count column (duplicate anchors already collapsed upstream)', () => {
		const facts = [makeFact({ source_page_id: 1, count: 5 })];
		const [summary] = deriveExternalLinkSummaryRows(facts);
		expect(summary).toMatchObject({ referrer_count: 1 });
	});

	it('produces one summary row per unique dest_page_id', () => {
		const facts = [
			makeFact({
				source_page_id: 1,
				dest_page_id: 100,
				dest_url_sort_key: 'https://ads.example.com',
			}),
			makeFact({
				source_page_id: 1,
				dest_page_id: 200,
				dest_url_sort_key: 'https://tracking.example.com',
				status: 404,
			}),
		];
		const summaries = deriveExternalLinkSummaryRows(facts);
		expect(summaries).toHaveLength(2);
		expect(summaries).toEqual(
			expect.arrayContaining([
				{
					dest_page_id: 100,
					dest_url: 'https://ads.example.com',
					status: 200,
					referrer_count: 1,
				},
				{
					dest_page_id: 200,
					dest_url: 'https://tracking.example.com',
					status: 404,
					referrer_count: 1,
				},
			]),
		);
	});
});
