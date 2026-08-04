import { describe, expect, it } from 'vitest';

import { getMismatchesSortSpec } from './get-mismatches-sort-spec.js';

describe('getMismatchesSortSpec', () => {
	it('urlBinary sorts on url_sort_key/mismatch_id, scanned ascending', () => {
		expect(getMismatchesSortSpec('urlBinary', 'asc')).toEqual({
			columns: ['url_sort_key', 'mismatch_id'],
			scanDirection: 'asc',
		});
	});

	it('sorts descending by flipping the scan direction, no negated key needed', () => {
		expect(getMismatchesSortSpec('urlBinary', 'desc')).toEqual({
			columns: ['url_sort_key', 'mismatch_id'],
			scanDirection: 'desc',
		});
	});

	it('urlNatural sorts on natural_url_rank/mismatch_id', () => {
		expect(getMismatchesSortSpec('urlNatural', 'asc')).toEqual({
			columns: ['natural_url_rank', 'mismatch_id'],
			scanDirection: 'asc',
		});
	});

	it('actual sorts on actual/mismatch_id', () => {
		expect(getMismatchesSortSpec('actual', 'asc')).toEqual({
			columns: ['actual', 'mismatch_id'],
			scanDirection: 'asc',
		});
	});

	it('expected sorts on expected/mismatch_id', () => {
		expect(getMismatchesSortSpec('expected', 'desc')).toEqual({
			columns: ['expected', 'mismatch_id'],
			scanDirection: 'desc',
		});
	});
});
