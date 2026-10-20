import { describe, expect, it } from 'vitest';

import { compileSelector } from './compile-selector.js';
import { isDecidableFromOneStartTag } from './is-decidable-from-one-start-tag.js';

/**
 * Whether the first alternative of a selector is decided by one start tag.
 * @param selector - The selector.
 */
function decidable(selector: string): boolean {
	return isDecidableFromOneStartTag(compileSelector(selector).alternatives[0]!);
}

describe('isDecidableFromOneStartTag', () => {
	it.each([
		['img'],
		['*'],
		['img[alt]'],
		['a.nav#main[href^="/p/"]'],
		['a:not(.x):not([hidden])'],
		['a[x="a b"]'],
		['a:not([x="a&b"])'],
	])('is true for %s', (selector) => {
		expect(decidable(selector)).toBe(true);
	});

	it.each([['nav a'], ['nav > a'], ['a b c']])(
		'is false for the combinator chain %s',
		(selector) => {
			expect(decidable(selector)).toBe(false);
		},
	);

	it.each([
		['li:first-child'],
		['li:nth-child(2)'],
		['li:first-of-type'],
		['li:nth-of-type(2n+1)'],
		['li:not(:first-child)'],
		['li:not(:nth-of-type(2))'],
	])('is false for the sibling-position test in %s', (selector) => {
		expect(decidable(selector)).toBe(false);
	});

	it.each([
		['a[title="x>y"]'],
		['a[title="x<y"]'],
		['a:not([title*="<"])'],
		['a[title~="<"]'],
	])('is false for a value with no single stored form: %s', (selector) => {
		expect(decidable(selector)).toBe(false);
	});

	it('does not look at a value that is never compared', () => {
		// An empty value never matches ^= $= *= ~=; a ~= value with whitespace never matches.
		expect(decidable('a[x^=""]')).toBe(true);
		expect(decidable('a[x~="a b<"]')).toBe(true);
		expect(decidable('a[x]')).toBe(true);
	});
});
