import { describe, it, expect } from 'vitest';

import { computeTierBAliasKey } from './compute-tier-b-alias-key.js';

describe('computeTierBAliasKey', () => {
	it('folds a trailing-slash-only difference to the same key', () => {
		expect(computeTierBAliasKey('https://example.com/foo')).toBe(
			computeTierBAliasKey('https://example.com/foo/'),
		);
	});

	it('leaves the bare root path alone (does not become empty)', () => {
		expect(computeTierBAliasKey('https://example.com/')).toBe(
			computeTierBAliasKey('https://example.com'),
		);
	});

	it('still folds /index.{ext} suffix variance (inherits Tier A folding)', () => {
		expect(computeTierBAliasKey('https://example.com/about/index.html')).toBe(
			computeTierBAliasKey('https://example.com/about'),
		);
	});

	it('returns null for an unparseable URL', () => {
		expect(computeTierBAliasKey('not a url')).toBeNull();
	});
});
