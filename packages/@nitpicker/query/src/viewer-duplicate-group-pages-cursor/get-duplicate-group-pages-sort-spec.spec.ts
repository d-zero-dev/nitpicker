import { describe, expect, it } from 'vitest';

import { getDuplicateGroupPagesSortSpec } from './get-duplicate-group-pages-sort-spec.js';

describe('getDuplicateGroupPagesSortSpec', () => {
	it('always sorts by url_sort_key ascending, tie-broken by page_id', () => {
		expect(getDuplicateGroupPagesSortSpec()).toEqual({
			columns: ['url_sort_key', 'page_id'],
			scanDirection: 'asc',
		});
	});
});
