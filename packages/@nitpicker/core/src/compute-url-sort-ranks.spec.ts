import { describe, it, expect } from 'vitest';

import { computeUrlSortRanks } from './compute-url-sort-ranks.js';
import { nativeBinding } from './native-binding.js';

/**
 * The URLs in sorted order, by their ranks.
 * @param urls - The URLs to sort.
 */
function sortByRank(urls: readonly string[]): string[] {
	const ranks = computeUrlSortRanks(urls);
	const sorted: string[] = [];
	for (const [position, rank] of ranks.entries()) {
		sorted[rank] = urls[position]!;
	}
	return sorted;
}

describe('computeUrlSortRanks', () => {
	it('ranks numbers in a path by value', () => {
		expect([
			...computeUrlSortRanks([
				'https://example.com/page10',
				'https://example.com/page2',
				'https://example.com/',
			]),
		]).toStrictEqual([2, 1, 0]);
	});

	it('returns no ranks for no URLs', () => {
		expect(computeUrlSortRanks([])).toHaveLength(0);
	});

	it('gives every URL its own rank, identical URLs in input order', () => {
		expect([
			...computeUrlSortRanks([
				'https://example.com/a',
				'https://example.com/a',
				'https://example.com/a',
			]),
		]).toStrictEqual([0, 1, 2]);
	});

	it('orders a directory, its index pages and its children', () => {
		const expected = [
			'https://example.com/a',
			'https://example.com/a/',
			'https://example.com/a/index.html',
			'https://example.com/a/b/',
			'https://example.com/a/b.html',
		];
		expect(sortByRank([...expected].toReversed())).toStrictEqual(expected);
	});

	it('orders the trio that pairwise number parsing could not order consistently', () => {
		const expected = [
			'https://example.com/a1x',
			'https://example.com/a9',
			'https://example.com/a10',
		];
		expect(sortByRank([expected[2]!, expected[0]!, expected[1]!])).toStrictEqual(
			expected,
		);
	});

	it('does not let letter case or percent-escapes split the order', () => {
		const expected = [
			'https://example.com/Apple',
			'https://example.com/banana',
			'https://example.com/%E3%81%82',
		];
		expect(sortByRank([expected[1]!, expected[2]!, expected[0]!])).toStrictEqual(
			expected,
		);
	});

	it('compares multibyte URLs the same as ASCII ones, by character', () => {
		const expected = [
			'https://example.com/あ',
			'https://example.com/い',
			'https://example.com/😀',
		];
		expect(sortByRank([expected[2]!, expected[0]!, expected[1]!])).toStrictEqual(
			expected,
		);
	});

	it('orders hosts by the form the URL standard normalizes them to', () => {
		// A full-width host folds to `zz.example`, which sorts after `b.example`.
		expect([
			...computeUrlSortRanks(['https://ＺＺ.example/', 'https://b.example/']),
		]).toStrictEqual([1, 0]);
		// An upper-case host folds to lower case, so only the path decides.
		expect([
			...computeUrlSortRanks(['https://B.example/z', 'https://b.example/a']),
		]).toStrictEqual([1, 0]);
	});

	it('does not throw on a string with a lone surrogate and still ranks every URL', () => {
		const ranks = computeUrlSortRanks([
			'https://example.com/\uD800',
			'https://example.com/a',
		]);
		expect([...ranks].toSorted((a, b) => a - b)).toStrictEqual([0, 1]);
	});

	it('sorts URLs that are not HTTP ahead of HTTP ones', () => {
		const expected = [
			'not a url',
			'mailto:someone@example.com',
			'https://a.example.com/',
		];
		expect(sortByRank([expected[2]!, expected[1]!, expected[0]!])).toStrictEqual(
			expected,
		);
	});

	it('keeps a ranking of many URLs a permutation', () => {
		const urls = Array.from(
			{ length: 5000 },
			(_, index) => `https://example.com/p/${(index * 7919) % 5000}`,
		);
		const ranks = [...computeUrlSortRanks(urls)].toSorted((a, b) => a - b);
		expect(ranks[0]).toBe(0);
		expect(ranks.at(-1)).toBe(4999);
		expect(new Set(ranks).size).toBe(5000);
	});
});

describe('nativeBinding.computeUrlSortRanks', () => {
	const bytes = new TextEncoder().encode('https://example.com/ahttps://example.com/b');

	it('rejects offsets that do not start at 0', () => {
		expect(() =>
			nativeBinding.computeUrlSortRanks(bytes, new Uint32Array([1, 42])),
		).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});

	it('rejects offsets that run past the bytes', () => {
		expect(() =>
			nativeBinding.computeUrlSortRanks(bytes, new Uint32Array([0, 99])),
		).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});

	it('rejects offsets that do not ascend', () => {
		expect(() =>
			nativeBinding.computeUrlSortRanks(bytes, new Uint32Array([0, 30, 20, 42])),
		).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});

	it('rejects offsets that stop before the end of the bytes', () => {
		expect(() =>
			nativeBinding.computeUrlSortRanks(bytes, new Uint32Array([0, 21])),
		).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});

	it('rejects empty offsets', () => {
		expect(() => nativeBinding.computeUrlSortRanks(bytes, new Uint32Array())).toThrow(
			expect.objectContaining({ code: 'InvalidArg' }),
		);
	});

	it('rejects bytes that are not UTF-8', () => {
		expect(() =>
			nativeBinding.computeUrlSortRanks(
				new Uint8Array([255, 254]),
				new Uint32Array([0, 2]),
			),
		).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});

	it('ranks the URLs the offsets cut out', () => {
		expect([
			...nativeBinding.computeUrlSortRanks(bytes, new Uint32Array([0, 21, 42])),
		]).toStrictEqual([0, 1]);
	});

	it('accepts the offsets of an empty list', () => {
		expect(
			nativeBinding.computeUrlSortRanks(new Uint8Array(), new Uint32Array([0])),
		).toHaveLength(0);
	});
});
