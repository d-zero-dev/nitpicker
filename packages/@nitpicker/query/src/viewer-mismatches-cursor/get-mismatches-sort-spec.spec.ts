import { describe, expect, it } from 'vitest';

import { getMismatchesSortSpec } from './get-mismatches-sort-spec.js';

describe('getMismatchesSortSpec', () => {
	it('sorts ascending using url_sort_key/mismatch_id, scanned ascending', () => {
		expect(getMismatchesSortSpec('asc')).toEqual({
			columns: ['url_sort_key', 'mismatch_id'],
			scanDirection: 'asc',
		});
	});

	it('sorts descending by flipping the scan direction, no negated key needed', () => {
		expect(getMismatchesSortSpec('desc')).toEqual({
			columns: ['url_sort_key', 'mismatch_id'],
			scanDirection: 'desc',
		});
	});
});
