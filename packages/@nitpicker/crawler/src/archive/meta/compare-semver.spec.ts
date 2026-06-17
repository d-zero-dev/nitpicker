import { describe, it, expect } from 'vitest';

import { compareSemver } from './compare-semver.js';

describe('compareSemver', () => {
	it('returns 0 for equal versions', () => {
		expect(compareSemver('0.10.0', '0.10.0')).toBe(0);
		expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
	});

	it('returns negative when a < b', () => {
		expect(compareSemver('0.9.0', '0.10.0')).toBeLessThan(0);
		expect(compareSemver('0.10.0', '0.11.0')).toBeLessThan(0);
		expect(compareSemver('0.10.0', '1.0.0')).toBeLessThan(0);
	});

	it('returns positive when a > b', () => {
		expect(compareSemver('0.10.0', '0.9.0')).toBeGreaterThan(0);
		expect(compareSemver('0.10.5', '0.10.0')).toBeGreaterThan(0);
		expect(compareSemver('1.0.0', '0.999.999')).toBeGreaterThan(0);
	});

	it('handles 2-component versions (defaults patch to 0)', () => {
		expect(compareSemver('0.10', '0.10.0')).toBe(0);
		expect(compareSemver('0.10', '0.10.1')).toBeLessThan(0);
	});

	it('handles 1-component versions (defaults minor + patch to 0)', () => {
		expect(compareSemver('1', '1.0.0')).toBe(0);
		expect(compareSemver('1', '0.999.999')).toBeGreaterThan(0);
	});

	it('strips pre-release tag', () => {
		expect(compareSemver('0.10.0-alpha.1', '0.10.0')).toBe(0);
		expect(compareSemver('0.10.0-rc.5', '0.10.0-beta.2')).toBe(0);
		expect(compareSemver('0.10.0-alpha', '0.9.99')).toBeGreaterThan(0);
	});

	it('strips build metadata', () => {
		expect(compareSemver('0.10.0+sha.abc', '0.10.0')).toBe(0);
		expect(compareSemver('0.10.0+1', '0.10.0+2')).toBe(0);
	});

	it('treats non-numeric components as 0 (defensive against hand-edited info.version)', () => {
		expect(compareSemver('garbage', '0.0.0')).toBe(0);
		expect(compareSemver('0.foo.bar', '0.0.0')).toBe(0);
		expect(compareSemver('0.10.0', 'garbage')).toBeGreaterThan(0);
	});

	it('compares lexicographic-style 0.10 > 0.9 (NOT lexicographic)', () => {
		// "0.10.0".localeCompare("0.9.0") would say "0.10.0" < "0.9.0"
		// because the strings are compared char-by-char. This test pins
		// that the helper does numeric comparison instead.
		expect(compareSemver('0.10.0', '0.9.0')).toBeGreaterThan(0);
	});
});
