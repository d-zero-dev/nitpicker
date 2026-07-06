import { describe, expect, it } from 'vitest';

import { getHeaderChecksSortSpec } from './get-header-checks-sort-spec.js';

describe('getHeaderChecksSortSpec', () => {
	it('sorts ascending using url_sort_key/page_id, scanned ascending', () => {
		expect(getHeaderChecksSortSpec('asc')).toEqual({
			columns: ['url_sort_key', 'page_id'],
			scanDirection: 'asc',
		});
	});

	it('sorts descending by flipping the scan direction, no negated key needed', () => {
		expect(getHeaderChecksSortSpec('desc')).toEqual({
			columns: ['url_sort_key', 'page_id'],
			scanDirection: 'desc',
		});
	});
});
