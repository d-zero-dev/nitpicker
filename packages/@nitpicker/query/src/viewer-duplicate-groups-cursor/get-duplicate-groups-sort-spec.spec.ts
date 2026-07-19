import { describe, expect, it } from 'vitest';

import { getDuplicateGroupsSortSpec } from './get-duplicate-groups-sort-spec.js';

describe('getDuplicateGroupsSortSpec', () => {
	it('always sorts by count_desc_key ascending, tie-broken by group_id', () => {
		expect(getDuplicateGroupsSortSpec()).toEqual({
			columns: ['count_desc_key', 'group_id'],
			scanDirection: 'asc',
		});
	});
});
