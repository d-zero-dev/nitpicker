import { describe, it, expect } from 'vitest';

import { computeTierAAliasKey } from './compute-tier-a-alias-key.js';

describe('computeTierAAliasKey', () => {
	it('folds http and https to the same key', () => {
		expect(computeTierAAliasKey('http://example.com/about')).toBe(
			computeTierAAliasKey('https://example.com/about'),
		);
	});

	it('folds host letter-casing to the same key', () => {
		expect(computeTierAAliasKey('https://Example.COM/about')).toBe(
			computeTierAAliasKey('https://example.com/about'),
		);
	});

	it('folds /index.{ext} suffix variance to the same key', () => {
		const withIndex = computeTierAAliasKey('https://example.com/about/index.html');
		const withoutIndex = computeTierAAliasKey('https://example.com/about/');
		expect(withIndex).toBe(withoutIndex);
	});

	it('folds the root /index.html to the root path', () => {
		expect(computeTierAAliasKey('https://example.com/index.html')).toBe(
			computeTierAAliasKey('https://example.com/'),
		);
	});

	it('folds various /index.{ext} extensions the same way', () => {
		const root = computeTierAAliasKey('https://example.com/section/');
		for (const ext of ['html', 'htm', 'php', 'asp']) {
			expect(computeTierAAliasKey(`https://example.com/section/index.${ext}`)).toBe(root);
		}
	});

	it('does NOT fold a trailing-slash-only difference (that is Tier B)', () => {
		expect(computeTierAAliasKey('https://example.com/about')).not.toBe(
			computeTierAAliasKey('https://example.com/about/'),
		);
	});

	it('leaves the query string untouched and distinguishing', () => {
		const a = computeTierAAliasKey('https://example.com/about?x=1');
		const b = computeTierAAliasKey('https://example.com/about?x=2');
		expect(a).not.toBe(b);
		expect(computeTierAAliasKey('https://example.com/about?x=1')).toBe(
			computeTierAAliasKey('https://example.com/about?x=1'),
		);
	});

	it('distinguishes an explicit non-default port from the scheme default', () => {
		expect(computeTierAAliasKey('https://example.com:8443/about')).not.toBe(
			computeTierAAliasKey('https://example.com/about'),
		);
	});

	it('returns null for an unparseable URL', () => {
		expect(computeTierAAliasKey('not a url')).toBeNull();
	});

	it('returns null for a non-http(s) scheme', () => {
		expect(computeTierAAliasKey('ftp://example.com/file.txt')).toBeNull();
	});

	it('is transitive across a chain of distinct fold reasons (A~B via index-suffix, B~C via host-case)', () => {
		const a = 'https://example.com/about/index.html';
		const b = 'https://example.com/about/';
		const c = 'https://Example.com/about/';
		const keyA = computeTierAAliasKey(a);
		const keyB = computeTierAAliasKey(b);
		const keyC = computeTierAAliasKey(c);
		expect(keyA).toBe(keyB);
		expect(keyB).toBe(keyC);
		expect(keyA).toBe(keyC);
	});
});
