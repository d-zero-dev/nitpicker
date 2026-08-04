import type { HeaderChecksKeysetRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { extractHeaderChecksSortValues } from './extract-header-checks-sort-values.js';

describe('extractHeaderChecksSortValues', () => {
	it('extracts values in spec.columns order', () => {
		const row: HeaderChecksKeysetRow = {
			page_id: 7,
			url_sort_key: 'https://example.com/a',
			natural_url_rank: 3,
			has_csp: 1,
			has_x_frame_options: 0,
			has_x_content_type_options: 1,
			has_hsts: 0,
		};
		const values = extractHeaderChecksSortValues(
			{ columns: ['url_sort_key', 'page_id'], scanDirection: 'asc' },
			row,
		);
		expect(values).toEqual(['https://example.com/a', 7]);
	});

	it('extracts natural_url_rank / header-flag columns for their specs', () => {
		const row: HeaderChecksKeysetRow = {
			page_id: 7,
			url_sort_key: 'https://example.com/a',
			natural_url_rank: 3,
			has_csp: 1,
			has_x_frame_options: 0,
			has_x_content_type_options: 1,
			has_hsts: 0,
		};
		expect(
			extractHeaderChecksSortValues(
				{ columns: ['natural_url_rank', 'page_id'], scanDirection: 'asc' },
				row,
			),
		).toEqual([3, 7]);
		expect(
			extractHeaderChecksSortValues(
				{ columns: ['has_csp', 'page_id'], scanDirection: 'asc' },
				row,
			),
		).toEqual([1, 7]);
	});
});
