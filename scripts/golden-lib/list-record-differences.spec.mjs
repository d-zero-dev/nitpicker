import { describe, it, expect } from 'vitest';

import { listRecordDifferences } from './list-record-differences.mjs';

describe('listRecordDifferences', () => {
	it('reports changed, missing and extra keys in order', () => {
		expect(
			listRecordDifferences({ a: '1', b: '2', d: '4' }, { a: '1', b: '9', c: '3' }),
		).toEqual(['b', 'c', 'd']);
	});

	it('reports nothing for equal maps', () => {
		expect(listRecordDifferences({ a: '1' }, { a: '1' })).toEqual([]);
	});

	it('treats an empty-string value as present', () => {
		expect(listRecordDifferences({ a: '' }, {})).toEqual(['a']);
	});
});
