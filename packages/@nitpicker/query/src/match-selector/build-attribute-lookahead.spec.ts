import type { AttributeOperator } from './types.js';

import { describe, expect, it } from 'vitest';

import { buildAttributeLookahead } from './build-attribute-lookahead.js';

/**
 * Runs the lookahead from just after the `<` of a start tag.
 * @param operator - The attribute operator.
 * @param value - The selector's attribute value.
 * @param startTag - The start tag text.
 * @param options - Further settings.
 * @param options.name - The attribute name (default `x`).
 * @param options.ignoreCase - Whether the test ignores ASCII case.
 */
function matches(
	operator: AttributeOperator,
	value: string,
	startTag: string,
	options: { name?: string; ignoreCase?: boolean } = {},
): boolean {
	const body = buildAttributeLookahead({
		name: options.name ?? 'x',
		operator,
		value,
		ignoreCase: options.ignoreCase ?? false,
	});
	return new RegExp(`^<(?=${body})`).test(startTag);
}

describe('buildAttributeLookahead', () => {
	it.each([
		['exists', '', '<a x="1">', true],
		['exists', '', '<a x="">', true],
		['exists', '', '<a y="1">', false],
		['exists', '', '<a data-x="1">', false],
		['exists', '', '<a title="x" x="1">', true],
		['equals', 'v', '<a x="v">', true],
		['equals', 'v', '<a x="vv">', false],
		['equals', 'v', '<a y="x v" x="v">', true],
		['equals', 'v', '<a title=" x=&quot;v&quot;">', false],
		['prefix', 'ab', '<a x="abc">', true],
		['prefix', 'bc', '<a x="abc">', false],
		['suffix', 'bc', '<a x="abc">', true],
		['suffix', 'ab', '<a x="abc">', false],
		['substring', 'b', '<a x="abc">', true],
		['substring', 'd', '<a x="abc">', false],
		['includes', 'b', '<a x="a b c">', true],
		['includes', 'b', '<a x="b">', true],
		['includes', 'b', '<a x="a bc">', false],
		['includes', 'b', '<a x="ab">', false],
		['dash', 'en', '<a x="en">', true],
		['dash', 'en', '<a x="en-US">', true],
		['dash', 'en', '<a x="english">', false],
		// an attribute value that looks like another attribute is not an attribute
		['exists', '', '<a title=" x=&quot;v&quot;">', false],
		['equals', 'v', '<a title="a x=v">', false],
		['exists', '', '<a title="a > b" x="1">', true],
	] as [AttributeOperator, string, string, boolean][])(
		'%s %j on %s → %s',
		(operator, value, startTag, expected) => {
			expect(matches(operator, value, startTag)).toBe(expected);
		},
	);

	describe('entity boundaries', () => {
		it.each([
			['substring', 'amp', '<a x="&amp;">', false],
			['substring', '&', '<a x="&amp;">', true],
			// stored `a&amp;amp;` decodes to `a&amp;`, which does contain `amp`
			['substring', 'amp', '<a x="a&amp;amp;">', true],
			['substring', 'amp', '<a x="&amp;amp;">', true],
			['substring', 'lt', '<a x="&lt;">', false],
			['suffix', ';', '<a x="&amp;">', false],
			['suffix', '&', '<a x="&amp;">', true],
			['suffix', 'p;', '<a x="&amp;">', false],
			['suffix', 'y', '<a x="x&amp;y">', true],
			['substring', 'a&b', '<a x="xa&amp;by">', true],
			['prefix', '&', '<a x="&amp;z">', true],
			['prefix', 'amp', '<a x="&amp;z">', false],
			['includes', '&', '<a x="x &amp; y">', true],
			['includes', 'amp', '<a x="x &amp; y">', false],
			['equals', '&amp;', '<a x="&amp;amp;">', true],
			['equals', '&amp;', '<a x="&amp;">', false],
			['equals', 'a b', '<a x="a&nbsp;b">', false],
			['equals', 'a b', '<a x="a&nbsp;b">', true],
			['equals', 'say "hi"', '<a x="say &quot;hi&quot;">', true],
		] as [AttributeOperator, string, string, boolean][])(
			'%s %j on %s → %s',
			(operator, value, startTag, expected) => {
				expect(matches(operator, value, startTag)).toBe(expected);
			},
		);
	});

	it('folds case of the name always and of the value on request', () => {
		expect(matches('equals', 'v', '<svg viewBox="v">', { name: 'viewbox' })).toBe(true);
		expect(matches('equals', 'v', '<a x="V">')).toBe(false);
		expect(matches('equals', 'v', '<a x="V">', { ignoreCase: true })).toBe(true);
	});

	it.each([
		['prefix', ''],
		['suffix', ''],
		['substring', ''],
		['includes', ''],
		['includes', 'a b'],
		['includes', 'a\tb'],
	] as [AttributeOperator, string][])('never matches %s with %j', (operator, value) => {
		expect(matches(operator, value, '<a x="a b">')).toBe(false);
		expect(matches(operator, value, '<a x="">')).toBe(false);
	});

	it('matches an empty value for equals and dash', () => {
		expect(matches('equals', '', '<a x="">')).toBe(true);
		expect(matches('dash', '', '<a x="">')).toBe(true);
		expect(matches('dash', '', '<a x="-b">')).toBe(true);
	});

	it.each(['a<b', 'a>b'])(
		'has no lookahead for a value with no single stored form: %j',
		(value) => {
			expect(
				buildAttributeLookahead({
					name: 'x',
					operator: 'equals',
					value,
					ignoreCase: false,
				}),
			).toBeNull();
		},
	);
});
