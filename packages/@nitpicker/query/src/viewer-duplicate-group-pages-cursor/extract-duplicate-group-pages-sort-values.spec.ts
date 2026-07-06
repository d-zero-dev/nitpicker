import type { DuplicateGroupPagesKeysetRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { extractDuplicateGroupPagesSortValues } from './extract-duplicate-group-pages-sort-values.js';

describe('extractDuplicateGroupPagesSortValues', () => {
	it('extracts values in spec.columns order', () => {
		const row: DuplicateGroupPagesKeysetRow = {
			page_id: 7,
			url_sort_key: 'https://example.com/a',
		};
		const values = extractDuplicateGroupPagesSortValues(
			{ columns: ['url_sort_key', 'page_id'], scanDirection: 'asc' },
			row,
		);
		expect(values).toEqual(['https://example.com/a', 7]);
	});
});
