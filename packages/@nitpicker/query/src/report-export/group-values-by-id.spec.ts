import { describe, expect, it } from 'vitest';

import { groupValuesById } from './group-values-by-id.js';

describe('groupValuesById', () => {
	it('groups multiple rows sharing an id into one bucket, in row order', () => {
		const rows = [
			{ id: 1, url: 'a' },
			{ id: 1, url: 'b' },
			{ id: 2, url: 'c' },
		];
		const result = groupValuesById(
			rows,
			(row) => row.id,
			(row) => row.url,
		);
		expect(result.get(1)).toEqual(['a', 'b']);
		expect(result.get(2)).toEqual(['c']);
	});

	it('returns an empty map for no rows', () => {
		const result = groupValuesById(
			[],
			(row: { id: number }) => row.id,
			(row: { id: number }) => row.id,
		);
		expect(result.size).toBe(0);
	});

	it('has no entry for an id with no matching row', () => {
		const result = groupValuesById(
			[{ id: 1, url: 'a' }],
			(row) => row.id,
			(row) => row.url,
		);
		expect(result.has(2)).toBe(false);
	});
});
