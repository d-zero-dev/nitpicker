import { describe, expect, it } from 'vitest';

import { extractSortValues } from './extract-sort-values.js';

describe('extractSortValues', () => {
	it('extracts values in the spec columns order, ignoring extra row fields', () => {
		const spec = {
			columns: ['title_sort_key', 'url_sort_key', 'page_id'],
			scanDirection: 'asc',
		} as const;
		const row = {
			page_id: 42,
			url_sort_key: 'https://example.com/a',
			title_sort_key: 'A',
			status_sort_key: 200,
			status_desc_key: -200,
		};
		expect(extractSortValues(spec, row)).toEqual(['A', 'https://example.com/a', 42]);
	});

	it("extracts the url sort's two-column tuple", () => {
		const spec = { columns: ['url_sort_key', 'page_id'], scanDirection: 'desc' } as const;
		const row = {
			page_id: 7,
			url_sort_key: 'https://example.com/z',
			title_sort_key: '',
			status_sort_key: 200,
			status_desc_key: -200,
		};
		expect(extractSortValues(spec, row)).toEqual(['https://example.com/z', 7]);
	});
});
