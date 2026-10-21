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
		const privateUseArea = `https://example.com/${String.fromCodePoint(57_344)}`; // U+E000
		const supplementaryPlane = `https://example.com/${String.fromCodePoint(65_536)}`; // U+10000
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

	it('ranks a URL before every longer URL it is a prefix of', () => {
		const map = buildPageUrlRankMap([
			{ id: 1, url: 'https://example.com/ab' },
			{ id: 2, url: 'https://example.com/a' },
			{ id: 3, url: 'https://example.com/a\u{10000}' },
		]);
		expect(map.get(2)).toBe(0);
		expect(map.get(1)).toBe(1);
		expect(map.get(3)).toBe(2);
	});

	it('treats a lone surrogate as U+FFFD, as the UTF-8 encoding does', () => {
		// `Buffer.from` encodes a lone surrogate as U+FFFD (EF BF BD), so it
		// sorts after U+E000 (EE 80 80) and ties with a real U+FFFD, where the
		// ascending page id decides.
		const map = buildPageUrlRankMap([
			{ id: 1, url: `https://example.com/${String.fromCodePoint(65_533)}` },
			{ id: 2, url: 'https://example.com/\uD800' },
			{ id: 3, url: `https://example.com/${String.fromCodePoint(57_344)}` },
		]);
		expect(map.get(3)).toBe(0);
		expect(map.get(1)).toBe(1);
		expect(map.get(2)).toBe(2);
	});

	it.each([1, 2, 3, 4, 5, 6, 7, 8])(
		'orders random strings exactly as their UTF-8 bytes compare (seed %i)',
		(seedNumber) => {
			// A small deterministic generator, mixing ASCII, characters at every
			// UTF-8 length boundary (U+7F/U+80, U+7FF/U+800, U+D7FF, U+E000, U+FFFF,
			// U+10000, U+10FFFF), the replacement character and lone surrogates, so
			// the allocation-free comparison is checked against the byte-wise oracle
			// it must agree with. Strings are up to 8 characters long, so many share
			// prefixes and many are equal.
			let seed = Math.imul(seedNumber, 2_654_435_761) >>> 0;
			const next = (limit: number): number => {
				seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
				return seed % limit;
			};
			const alphabet = [
				'a',
				'b',
				'\u{7F}',
				'\u{80}',
				'é',
				'\u{7FF}',
				'\u{800}',
				'あ',
				'\u{D7FF}',
				'\u{E000}',
				'\u{FFFF}',
				'\u{FFFD}',
				'\u{10000}',
				'\u{1F600}',
				'\u{10FFFF}',
				'\uD800',
				'\uDBFF',
				'\uDC00',
				'\uDFFF',
			];
			const rows = Array.from({ length: 600 }, (_, index) => ({
				id: index + 1,
				url: Array.from({ length: next(9) }, () => alphabet[next(alphabet.length)]!).join(
					'',
				),
			}));
			const oracle = rows.toSorted((a, b) => {
				const byBytes = Buffer.compare(
					Buffer.from(a.url, 'utf8'),
					Buffer.from(b.url, 'utf8'),
				);
				return byBytes === 0 ? a.id - b.id : byBytes;
			});
			const map = buildPageUrlRankMap(rows);
			expect(oracle.map((row) => map.get(row.id))).toEqual(oracle.map((_, rank) => rank));
		},
	);
});
