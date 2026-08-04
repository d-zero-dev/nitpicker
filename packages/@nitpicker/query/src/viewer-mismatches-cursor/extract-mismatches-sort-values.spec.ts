import type { MismatchesKeysetRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { extractMismatchesSortValues } from './extract-mismatches-sort-values.js';

describe('extractMismatchesSortValues', () => {
	it('extracts values in spec.columns order', () => {
		const row: MismatchesKeysetRow = {
			mismatch_id: 7,
			url_sort_key: 'https://example.com/a',
			natural_url_rank: 3,
			actual: 'Actual value',
			expected: 'Expected value',
		};
		const values = extractMismatchesSortValues(
			{ columns: ['url_sort_key', 'mismatch_id'], scanDirection: 'asc' },
			row,
		);
		expect(values).toEqual(['https://example.com/a', 7]);
	});

	it('extracts natural_url_rank for the urlNatural spec', () => {
		const row: MismatchesKeysetRow = {
			mismatch_id: 7,
			url_sort_key: 'https://example.com/a',
			natural_url_rank: 3,
			actual: 'Actual value',
			expected: 'Expected value',
		};
		const values = extractMismatchesSortValues(
			{ columns: ['natural_url_rank', 'mismatch_id'], scanDirection: 'asc' },
			row,
		);
		expect(values).toEqual([3, 7]);
	});
});
