import { describe, expect, it } from 'vitest';

import { extractSortValues } from './extract-sort-values.js';

describe('extractSortValues', () => {
	it('extracts values in the spec columns order, ignoring extra row fields', () => {
		const spec = {
			columns: ['page_url_rank', 'image_id'],
			scanDirection: 'asc',
		} as const;
		const row = {
			image_id: 42,
			page_url_rank: 3,
			width: 100,
			height: 50,
			natural_width: 100,
			natural_height: 50,
			is_lazy: 0,
		};
		expect(extractSortValues(spec, row)).toEqual([3, 42]);
	});

	it('extracts a single-column tuple for a non-default sort field', () => {
		const spec = {
			columns: ['natural_width', 'image_id'],
			scanDirection: 'desc',
		} as const;
		const row = {
			image_id: 7,
			page_url_rank: 1,
			width: 20,
			height: 20,
			natural_width: 2000,
			natural_height: 1500,
			is_lazy: 1,
		};
		expect(extractSortValues(spec, row)).toEqual([2000, 7]);
	});
});
