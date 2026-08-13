import { describe, expect, it } from 'vitest';

import { buildDemoRows } from './demo-table-fixtures.js';

describe('buildDemoRows', () => {
	it('generates exactly `count` rows', () => {
		expect(buildDemoRows(5)).toHaveLength(5);
	});

	it('returns an empty array for `count` 0', () => {
		expect(buildDemoRows(0)).toEqual([]);
	});

	it('marks the first row and every 7th row after it as a 404, the rest as 200', () => {
		const rows = buildDemoRows(14);
		expect(rows.map((row) => row.status)).toEqual([
			404, 200, 200, 200, 200, 200, 200, 404, 200, 200, 200, 200, 200, 200,
		]);
	});

	it('numbers URLs and titles sequentially starting at 1', () => {
		const rows = buildDemoRows(3);
		expect(rows.map((row) => row.url)).toEqual([
			'https://example.com/page-1',
			'https://example.com/page-2',
			'https://example.com/page-3',
		]);
		expect(rows.map((row) => row.title)).toEqual([
			'Sample page 1',
			'Sample page 2',
			'Sample page 3',
		]);
	});
});
