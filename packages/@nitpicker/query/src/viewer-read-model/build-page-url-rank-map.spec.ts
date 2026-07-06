import { describe, expect, it } from 'vitest';

import { buildPageUrlRankMap } from './build-page-url-rank-map.js';

describe('buildPageUrlRankMap', () => {
	it('ranks pages in URL-ascending order, zero-based', () => {
		const map = buildPageUrlRankMap([
			{ id: 3, url: 'https://example.com/c' },
			{ id: 1, url: 'https://example.com/a' },
			{ id: 2, url: 'https://example.com/b' },
		]);
		expect(map.get(1)).toBe(0);
		expect(map.get(2)).toBe(1);
		expect(map.get(3)).toBe(2);
	});

	it('breaks ties on equal URLs by ascending page id', () => {
		const map = buildPageUrlRankMap([
			{ id: 20, url: 'https://example.com/dup' },
			{ id: 10, url: 'https://example.com/dup' },
		]);
		expect(map.get(10)).toBe(0);
		expect(map.get(20)).toBe(1);
	});

	it('returns an empty map for an empty input', () => {
		expect(buildPageUrlRankMap([]).size).toBe(0);
	});

	it('ranks by UTF-8 byte order (SQLite BINARY collation), not JS UTF-16 code-unit order — regression test for a supplementary-plane divergence', () => {
		// U+E000 (Private Use Area) encodes to UTF-8 bytes starting 0xEE.
		// U+10000 (supplementary plane) encodes to UTF-8 bytes starting 0xF0,
		// but as a UTF-16 surrogate pair whose leading unit is 0xD800 — LESS
		// than 0xE000. A plain JS `<` comparison would rank the U+10000 page
		// first; SQLite's byte-wise BINARY collation (and thus
		// `viewer_pages.url_sort_key`) ranks the U+E000 page first, since
		// 0xEE < 0xF0.
		const privateUseArea = `https://example.com/${String.fromCodePoint(0xe0_00)}`;
		const supplementaryPlane = `https://example.com/${String.fromCodePoint(0x1_00_00)}`;
		const map = buildPageUrlRankMap([
			{ id: 2, url: supplementaryPlane },
			{ id: 1, url: privateUseArea },
		]);
		expect(map.get(1)).toBe(0);
		expect(map.get(2)).toBe(1);
	});

	it('does not mutate the input array', () => {
		const input = [
			{ id: 2, url: 'https://example.com/b' },
			{ id: 1, url: 'https://example.com/a' },
		];
		const original = [...input];
		buildPageUrlRankMap(input);
		expect(input).toEqual(original);
	});
});
