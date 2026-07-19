import { describe, expect, it } from 'vitest';

import { extractKeysetSortValues } from './extract-keyset-sort-values.js';

describe('extractKeysetSortValues', () => {
	it('extracts values in the spec columns order, ignoring extra row fields', () => {
		const spec = {
			columns: ['status_sort_key', 'url_sort_key', 'resource_id'],
			scanDirection: 'asc',
		} as const;
		const row = {
			resource_id: 42,
			url_sort_key: 'https://example.com/a.css',
			status_sort_key: 200,
			status_desc_key: -200,
		};
		expect(extractKeysetSortValues(spec, row)).toEqual([
			200,
			'https://example.com/a.css',
			42,
		]);
	});

	it('extracts a single-column tuple', () => {
		const spec = { columns: ['image_id'], scanDirection: 'desc' } as const;
		expect(extractKeysetSortValues(spec, { image_id: 7 })).toEqual([7]);
	});
});
