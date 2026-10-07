import { describe, expect, it } from 'vitest';

import { compileSelector } from './compile-selector.js';
import { derivePrefilterLiterals } from './derive-prefilter-literals.js';

/**
 * Derives the literals of the first comma alternative of a selector.
 * @param selector - The selector.
 */
function derive(selector: string): string[] | null {
	return derivePrefilterLiterals(compileSelector(selector).alternatives[0]!);
}

describe('derivePrefilterLiterals', () => {
	it('uses the tag opener for a bare tag', () => {
		expect(derive('nav a')).toEqual(['<nav', '<a']);
	});

	it('prefers id, then class, then attribute value, then tag, then attribute name', () => {
		expect(derive('a#Main.btn[href^="/x"]')).toEqual(['main']);
		expect(derive('a.btn[href^="/x"]')).toEqual(['btn']);
		expect(derive('a[href^="/x"]')).toEqual(['/x']);
		expect(derive('a[href]')).toEqual(['<a']);
		expect(derive('[data-k]')).toEqual(['data-k']);
	});

	it('lower-cases literals', () => {
		expect(derive('.Foo')).toEqual(['foo']);
		expect(derive('[x="ABC" i]')).toEqual(['abc']);
	});

	it('yields one literal per compound in ancestor-first order', () => {
		expect(derive('nav > .menu a[href^="/p"]')).toEqual(['<nav', 'menu', '/p']);
	});

	it.each([
		['[id="a b"][data-x=y]', ['y']],
		['.é.b', ['b']],
		['.a.b', ['a']],
		['[id^=ab]', ['ab']],
		['[class="a b"]', ['class']],
		['[x="a\'b"]', ['x']],
		['[x="a>b"]', ['x']],
		['[x="a\u007Fb"]', ['x']],
		['[x="a\u001Fb"]', ['x']],
	])('falls back through the priorities for %s', (selector, expected) => {
		expect(derive(selector)).toEqual(expected);
	});

	it('contributes nothing for the universal selector and for :not()', () => {
		expect(derive('*')).toBeNull();
		expect(derive(':not(.x)')).toBeNull();
		expect(derive('* > p')).toEqual(['<p']);
		expect(derive('li:not(.x)')).toEqual(['<li']);
	});

	// the value cannot be looked up verbatim, so only the attribute name is required
	it.each([
		['[data-x="a&b"]', ['data-x']],
		['[data-x="a\\"b"]', ['data-x']],
		['[data-x="a<b"]', ['data-x']],
		['[data-x="é"]', ['data-x']],
		['[data-x="a b"]', ['data-x']],
		['[data-x~="a b"]', ['data-x']],
		['[data-x^=""]', ['data-x']],
	])('does not use the value of %s', (selector, expected) => {
		expect(derive(selector)).toEqual(expected);
	});
});
