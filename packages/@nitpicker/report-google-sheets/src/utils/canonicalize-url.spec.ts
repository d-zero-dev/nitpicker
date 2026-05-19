import { describe, expect, it } from 'vitest';

import { canonicalizeUrl } from './canonicalize-url.js';

describe('canonicalizeUrl', () => {
	it('URL に query string がなければそのまま返す', () => {
		expect(canonicalizeUrl('https://example.com/path/to/resource.css')).toBe(
			'https://example.com/path/to/resource.css',
		);
	});

	it('? のみで値がない場合も head?​ を保持する', () => {
		expect(canonicalizeUrl('https://example.com/path?')).toBe(
			'https://example.com/path?',
		);
	});

	it('query value を捨て、key だけ残す', () => {
		expect(canonicalizeUrl('https://example.com/x?a=1&b=2')).toBe(
			'https://example.com/x?a&b',
		);
	});

	it('key を辞書順にソートする', () => {
		expect(canonicalizeUrl('https://example.com/x?b=Y&a=X')).toBe(
			'https://example.com/x?a&b',
		);
	});

	it('重複した key を1つにまとめる', () => {
		expect(canonicalizeUrl('https://example.com/x?a=1&a=2&a=3')).toBe(
			'https://example.com/x?a',
		);
	});

	it('値だけがあって key が空の pair はスキップする', () => {
		expect(canonicalizeUrl('https://example.com/x?=val&a=1')).toBe(
			'https://example.com/x?a',
		);
	});

	it('値が空の pair でも key は残す', () => {
		expect(canonicalizeUrl('https://example.com/x?a=&b=2')).toBe(
			'https://example.com/x?a&b',
		);
	});

	it('= を含まない key だけの pair も拾う', () => {
		expect(canonicalizeUrl('https://example.com/x?a&b=2')).toBe(
			'https://example.com/x?a&b',
		);
	});

	it('path に含まれる ID は触らない', () => {
		expect(
			canonicalizeUrl(
				'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/10840516367/?auid=ABC&capi=1&crd=XYZ',
			),
		).toBe(
			'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/10840516367/?auid&capi&crd',
		);
	});

	it('scheme / host / port を変更しない', () => {
		expect(canonicalizeUrl('https://example.com:8443/x?z=1&a=2')).toBe(
			'https://example.com:8443/x?a&z',
		);
	});

	it('encoded な key は文字列として比較される', () => {
		expect(canonicalizeUrl('https://example.com/x?expv2%5B1%5D=a&expv2%5B0%5D=b')).toBe(
			'https://example.com/x?expv2%5B0%5D&expv2%5B1%5D',
		);
	});

	it('blob: スキームの URL もそのまま返す', () => {
		expect(
			canonicalizeUrl('blob:https://example.com/0011095c-e2eb-41d6-b5cf-14d89129c9a0'),
		).toBe('blob:https://example.com/0011095c-e2eb-41d6-b5cf-14d89129c9a0');
	});
});
