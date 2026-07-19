import { describe, expect, it } from 'vitest';

import { buildPageNaturalUrlRankMap } from './build-page-natural-url-rank-map.js';

describe('buildPageNaturalUrlRankMap', () => {
	it('ranks pages in natural URL-ascending order, zero-based', () => {
		const map = buildPageNaturalUrlRankMap([
			{ id: 3, url: 'https://example.com/c' },
			{ id: 1, url: 'https://example.com/a' },
			{ id: 2, url: 'https://example.com/b' },
		]);
		expect(map.get(1)).toBe(0);
		expect(map.get(2)).toBe(1);
		expect(map.get(3)).toBe(2);
	});

	it('orders numeric path segments numerically, not lexicographically', () => {
		// This is the entire point of natural sort over BINARY collation:
		// "page2" must sort before "page10" (lexicographic order would put
		// "page10" first, since '1' < '2').
		const map = buildPageNaturalUrlRankMap([
			{ id: 10, url: 'https://example.com/page10' },
			{ id: 2, url: 'https://example.com/page2' },
			{ id: 1, url: 'https://example.com/page1' },
		]);
		expect(map.get(1)).toBe(0);
		expect(map.get(2)).toBe(1);
		expect(map.get(10)).toBe(2);
	});

	it('breaks ties on equal URLs by ascending page id', () => {
		const map = buildPageNaturalUrlRankMap([
			{ id: 20, url: 'https://example.com/dup' },
			{ id: 10, url: 'https://example.com/dup' },
		]);
		expect(map.get(10)).toBe(0);
		expect(map.get(20)).toBe(1);
	});

	it('returns an empty map for an empty input', () => {
		expect(buildPageNaturalUrlRankMap([]).size).toBe(0);
	});

	it('does not mutate the input array', () => {
		const input = [
			{ id: 2, url: 'https://example.com/b' },
			{ id: 1, url: 'https://example.com/a' },
		];
		const original = [...input];
		buildPageNaturalUrlRankMap(input);
		expect(input).toEqual(original);
	});
});
