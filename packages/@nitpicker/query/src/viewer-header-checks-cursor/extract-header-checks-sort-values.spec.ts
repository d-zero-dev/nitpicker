import type { HeaderChecksKeysetRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { extractHeaderChecksSortValues } from './extract-header-checks-sort-values.js';

describe('extractHeaderChecksSortValues', () => {
	it('extracts values in spec.columns order', () => {
		const row: HeaderChecksKeysetRow = {
			page_id: 7,
			url_sort_key: 'https://example.com/a',
		};
		const values = extractHeaderChecksSortValues(
			{ columns: ['url_sort_key', 'page_id'], scanDirection: 'asc' },
			row,
		);
		expect(values).toEqual(['https://example.com/a', 7]);
	});
});
