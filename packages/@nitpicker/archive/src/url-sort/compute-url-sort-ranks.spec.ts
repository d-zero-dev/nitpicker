import { describe, it, expect } from 'vitest';

import { computeUrlSortRanks } from './compute-url-sort-ranks.js';

describe('computeUrlSortRanks', () => {
	it('ranks numbers in a path by value and the root page first', () => {
		expect([
			...computeUrlSortRanks([
				'https://example.com/page10',
				'https://example.com/page2',
				'https://example.com/',
			]),
		]).toStrictEqual([2, 1, 0]);
	});

	it('gives the same ranking whatever order the URLs arrive in', () => {
		const sorted = [
			'https://example.com/a/',
			'https://example.com/a/index.html',
			'https://example.com/a/page2.html',
			'https://example.com/a/page10.html',
		];
		expect([...computeUrlSortRanks(sorted)]).toStrictEqual([0, 1, 2, 3]);
		expect([...computeUrlSortRanks([...sorted].toReversed())]).toStrictEqual([
			3, 2, 1, 0,
		]);
	});

	it('returns no ranks for no URLs', () => {
		expect(computeUrlSortRanks([])).toHaveLength(0);
	});
});
