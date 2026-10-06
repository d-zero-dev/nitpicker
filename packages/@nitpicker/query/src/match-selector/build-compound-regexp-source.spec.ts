import type { CompoundMatcher } from './types.js';

import { describe, expect, it } from 'vitest';

import { buildCompoundRegExpSource } from './build-compound-regexp-source.js';

const BASE: CompoundMatcher = { tag: null, attributes: [], nth: [], negations: [] };

/**
 * Tests a compound's regular expression source against the start of a start tag.
 * @param compound - The compound under test.
 * @param startTag - The start tag text.
 */
function matches(compound: CompoundMatcher, startTag: string): boolean {
	return new RegExp(`^${buildCompoundRegExpSource(compound)}`).test(startTag);
}

describe('buildCompoundRegExpSource', () => {
	it('matches a tag name on a name boundary', () => {
		const compound = { ...BASE, tag: 'art' };
		expect(matches(compound, '<art>')).toBe(true);
		expect(matches(compound, '<art class="x">')).toBe(true);
		expect(matches(compound, '<ART>')).toBe(true);
		expect(matches(compound, '<article>')).toBe(false);
		expect(matches(compound, '<a>')).toBe(false);
	});

	it('matches any start tag for the universal selector', () => {
		expect(matches(BASE, '<anything-at-all x="1">')).toBe(true);
		expect(matches(BASE, '</a>')).toBe(false);
		expect(matches(BASE, '<!-- x -->')).toBe(false);
	});

	it('accepts attributes in any order', () => {
		const compound: CompoundMatcher = {
			...BASE,
			tag: 'a',
			attributes: [
				{ name: 'class', operator: 'includes', value: 'x', ignoreCase: false },
				{ name: 'href', operator: 'prefix', value: '/p', ignoreCase: false },
			],
		};
		expect(matches(compound, '<a class="x" href="/p/1">')).toBe(true);
		expect(matches(compound, '<a href="/p/1" class="y x">')).toBe(true);
		expect(matches(compound, '<a href="/p/1">')).toBe(false);
	});

	it('turns :not() into a negative lookahead over the same start tag', () => {
		const compound: CompoundMatcher = {
			...BASE,
			tag: 'a',
			negations: [
				{
					tag: null,
					attributes: [
						{ name: 'class', operator: 'includes', value: 'x', ignoreCase: false },
					],
					nth: [],
				},
				{
					tag: 'a',
					attributes: [
						{ name: 'hidden', operator: 'exists', value: '', ignoreCase: false },
					],
					nth: [],
				},
			],
		};
		expect(matches(compound, '<a>')).toBe(true);
		expect(matches(compound, '<a class="x">')).toBe(false);
		expect(matches(compound, '<a hidden="">')).toBe(false);
		expect(matches(compound, '<a class="y" title="">')).toBe(true);
	});

	it('lets :not(*) match nothing', () => {
		const compound = { ...BASE, negations: [{ tag: null, attributes: [], nth: [] }] };
		expect(matches(compound, '<a>')).toBe(false);
	});

	it('matches nothing for an attribute that can never match', () => {
		const compound: CompoundMatcher = {
			...BASE,
			attributes: [{ name: 'x', operator: 'prefix', value: '', ignoreCase: false }],
		};
		expect(matches(compound, '<a x="v">')).toBe(false);
		const negated = { ...BASE, negations: [{ ...compound, nth: [] }] };
		expect(matches(negated, '<a x="v">')).toBe(true);
	});

	it('cannot be built for sibling-position tests', () => {
		const nth = { kind: 'child', a: 0, b: 1 } as const;
		expect(buildCompoundRegExpSource({ ...BASE, nth: [nth] })).toBeNull();
		expect(
			buildCompoundRegExpSource({
				...BASE,
				negations: [{ tag: null, attributes: [], nth: [nth] }],
			}),
		).toBeNull();
	});

	it('cannot be built for a value with no single stored form', () => {
		const attributes = [
			{ name: 'x', operator: 'equals', value: 'a>b', ignoreCase: false },
		] as const;
		expect(buildCompoundRegExpSource({ ...BASE, attributes })).toBeNull();
		expect(
			buildCompoundRegExpSource({
				...BASE,
				negations: [{ tag: null, attributes, nth: [] }],
			}),
		).toBeNull();
	});
});
