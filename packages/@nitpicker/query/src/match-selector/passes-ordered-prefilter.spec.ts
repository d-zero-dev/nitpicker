import { describe, expect, it } from 'vitest';

import { passesOrderedPrefilter } from './passes-ordered-prefilter.js';

describe('passesOrderedPrefilter', () => {
	it('passes without constraints', () => {
		expect(passesOrderedPrefilter('anything', null)).toBe(true);
		expect(passesOrderedPrefilter('', [])).toBe(true);
	});

	it('requires every literal, in order', () => {
		expect(passesOrderedPrefilter('<nav><a href="/x">', ['<nav', '<a'])).toBe(true);
		expect(passesOrderedPrefilter('<a></a><nav>', ['<nav', '<a'])).toBe(false);
		expect(passesOrderedPrefilter('<nav>', ['<nav', '<a'])).toBe(false);
		expect(passesOrderedPrefilter('<div>', ['<nav'])).toBe(false);
	});

	it('does not reuse the same text for two literals', () => {
		expect(passesOrderedPrefilter('<a>', ['<a', '<a'])).toBe(false);
		expect(passesOrderedPrefilter('<a><a>', ['<a', '<a'])).toBe(true);
	});

	it('takes the leftmost occurrence, which leaves the most room for the rest', () => {
		expect(passesOrderedPrefilter('<a><a><b>', ['<a', '<b'])).toBe(true);
		expect(passesOrderedPrefilter('<b><a><a>', ['<a', '<b'])).toBe(false);
	});

	it('answers quickly when an early literal is everywhere and the last is missing', () => {
		// Backtracking through every combination would not finish in the test timeout;
		// the greedy chain takes milliseconds, so the bound only guards the complexity.
		const html = '<a>'.repeat(300_000);
		const start = performance.now();
		expect(passesOrderedPrefilter(html, ['<a', '<a', '<a', '<a', '<a', '<z'])).toBe(
			false,
		);
		expect(performance.now() - start).toBeLessThan(5000);
	});
});
