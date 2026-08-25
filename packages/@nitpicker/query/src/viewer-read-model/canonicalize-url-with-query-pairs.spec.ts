import { describe, expect, it } from 'vitest';

import { canonicalizeUrlWithQueryPairs } from './canonicalize-url-with-query-pairs.js';

describe('canonicalizeUrlWithQueryPairs: canonical', () => {
	it('URL に query string がなければそのまま返す', () => {
		expect(
			canonicalizeUrlWithQueryPairs('https://example.com/path/to/resource.css').canonical,
		).toBe('https://example.com/path/to/resource.css');
	});

	it('? のみで値がない場合も head? を保持する', () => {
		expect(canonicalizeUrlWithQueryPairs('https://example.com/path?').canonical).toBe(
			'https://example.com/path?',
		);
	});

	it('query value を捨て、key だけ残す', () => {
		expect(canonicalizeUrlWithQueryPairs('https://example.com/x?a=1&b=2').canonical).toBe(
			'https://example.com/x?a&b',
		);
	});

	it('key を辞書順にソートする', () => {
		expect(canonicalizeUrlWithQueryPairs('https://example.com/x?b=Y&a=X').canonical).toBe(
			'https://example.com/x?a&b',
		);
	});

	it('重複した key を1つにまとめる', () => {
		expect(
			canonicalizeUrlWithQueryPairs('https://example.com/x?a=1&a=2&a=3').canonical,
		).toBe('https://example.com/x?a');
	});

	it('値だけがあって key が空の pair はスキップする', () => {
		expect(
			canonicalizeUrlWithQueryPairs('https://example.com/x?=val&a=1').canonical,
		).toBe('https://example.com/x?a');
	});

	it('値が空の pair でも key は残す', () => {
		expect(canonicalizeUrlWithQueryPairs('https://example.com/x?a=&b=2').canonical).toBe(
			'https://example.com/x?a&b',
		);
	});

	it('= を含まない key だけの pair も拾う', () => {
		expect(canonicalizeUrlWithQueryPairs('https://example.com/x?a&b=2').canonical).toBe(
			'https://example.com/x?a&b',
		);
	});

	it('path に含まれる ID は触らない', () => {
		expect(
			canonicalizeUrlWithQueryPairs(
				'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/10840516367/?auid=ABC&capi=1&crd=XYZ',
			).canonical,
		).toBe(
			'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/10840516367/?auid&capi&crd',
		);
	});

	it('scheme / host / port を変更しない', () => {
		expect(
			canonicalizeUrlWithQueryPairs('https://example.com:8443/x?z=1&a=2').canonical,
		).toBe('https://example.com:8443/x?a&z');
	});

	it('encoded な key は文字列として比較される', () => {
		expect(
			canonicalizeUrlWithQueryPairs('https://example.com/x?expv2%5B1%5D=a&expv2%5B0%5D=b')
				.canonical,
		).toBe('https://example.com/x?expv2%5B0%5D&expv2%5B1%5D');
	});

	it('blob: スキームの URL もそのまま返す', () => {
		expect(
			canonicalizeUrlWithQueryPairs(
				'blob:https://example.com/0011095c-e2eb-41d6-b5cf-14d89129c9a0',
			).canonical,
		).toBe('blob:https://example.com/0011095c-e2eb-41d6-b5cf-14d89129c9a0');
	});
});

describe('canonicalizeUrlWithQueryPairs: pairs', () => {
	it('query string がない URL は空配列を返す', () => {
		expect(canonicalizeUrlWithQueryPairs('https://example.com/path').pairs).toEqual([]);
	});

	it('? のみで値がない場合も空配列を返す', () => {
		expect(canonicalizeUrlWithQueryPairs('https://example.com/path?').pairs).toEqual([]);
	});

	it('key と value を source order で返す', () => {
		expect(canonicalizeUrlWithQueryPairs('https://example.com/p?a=1&b=2').pairs).toEqual([
			{ key: 'a', value: '1' },
			{ key: 'b', value: '2' },
		]);
	});

	it('同じ key が複数あれば全件残す (sort も dedupe もしない)', () => {
		expect(
			canonicalizeUrlWithQueryPairs('https://example.com/p?a=1&a=2&a=3').pairs,
		).toEqual([
			{ key: 'a', value: '1' },
			{ key: 'a', value: '2' },
			{ key: 'a', value: '3' },
		]);
	});

	it('= を含まない key は value="" として扱う', () => {
		expect(canonicalizeUrlWithQueryPairs('https://example.com/p?a&b=2').pairs).toEqual([
			{ key: 'a', value: '' },
			{ key: 'b', value: '2' },
		]);
	});

	it('値が空の pair も key と value="" を返す', () => {
		expect(canonicalizeUrlWithQueryPairs('https://example.com/p?a=&b=2').pairs).toEqual([
			{ key: 'a', value: '' },
			{ key: 'b', value: '2' },
		]);
	});

	it('key が空の pair はスキップする', () => {
		expect(canonicalizeUrlWithQueryPairs('https://example.com/p?=val&a=1').pairs).toEqual(
			[{ key: 'a', value: '1' }],
		);
	});

	it('値に = が含まれていても最初の = で分割する', () => {
		expect(
			canonicalizeUrlWithQueryPairs('https://example.com/p?token=abc=def=ghi').pairs,
		).toEqual([{ key: 'token', value: 'abc=def=ghi' }]);
	});
});

describe('canonicalizeUrlWithQueryPairs: equivalence with the former split functions', () => {
	it('produces the same canonical/pairs for a mixed URL in one pass', () => {
		const result = canonicalizeUrlWithQueryPairs('https://x.com/p/123?b=Y&a=X&a=Z');
		expect(result.canonical).toBe('https://x.com/p/123?a&b');
		expect(result.pairs).toEqual([
			{ key: 'b', value: 'Y' },
			{ key: 'a', value: 'X' },
			{ key: 'a', value: 'Z' },
		]);
	});
});
