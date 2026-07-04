import { describe, expect, it } from 'vitest';

import { extractSortValues } from './extract-sort-values.js';

describe('extractSortValues', () => {
	it('extracts values in the spec columns order, ignoring extra row fields', () => {
		const spec = {
			columns: ['source', 'url_sort_key', 'resource_id'],
			scanDirection: 'asc',
		} as const;
		const row = {
			resource_id: 42,
			url_sort_key: 'https://example.com/orphan.pdf',
			source: 'crawled',
			status_sort_key: 200,
			status_desc_key: -200,
		};
		expect(extractSortValues(spec, row)).toEqual([
			'crawled',
			'https://example.com/orphan.pdf',
			42,
		]);
	});

	it('extracts a single-column tuple for url sort', () => {
		const spec = {
			columns: ['url_sort_key', 'resource_id'],
			scanDirection: 'desc',
		} as const;
		const row = {
			resource_id: 7,
			url_sort_key: 'https://example.com/z.png',
			source: 'crawled',
			status_sort_key: 200,
			status_desc_key: -200,
		};
		expect(extractSortValues(spec, row)).toEqual(['https://example.com/z.png', 7]);
	});
});
