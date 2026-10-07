import { describe, expect, it } from 'vitest';

import { compileSelector } from './compile-selector.js';
import { SUPPORTED_SELECTOR_GRAMMAR } from './supported-selector-grammar.js';
import { UnsupportedSelectorError } from './unsupported-selector-error.js';

describe('compileSelector', () => {
	it('compiles a compound into its parts, folding tag and attribute names', () => {
		const { alternatives } = compileSelector('DIV.Foo#bar[Data-X^="a" i]');
		expect(alternatives).toHaveLength(1);
		expect(alternatives[0]!.compounds).toEqual([
			{
				tag: 'div',
				attributes: [
					{ name: 'class', operator: 'includes', value: 'Foo', ignoreCase: false },
					{ name: 'id', operator: 'equals', value: 'bar', ignoreCase: false },
					{ name: 'data-x', operator: 'prefix', value: 'a', ignoreCase: true },
				],
				nth: [],
				negations: [],
			},
		]);
	});

	it('keeps compounds ancestor-first with their combinators', () => {
		const [alternative] = compileSelector('a > b c').alternatives;
		expect(alternative!.compounds.map((c) => c.tag)).toEqual(['a', 'b', 'c']);
		expect(alternative!.combinators).toEqual(['child', 'descendant']);
	});

	it('makes one alternative per comma', () => {
		expect(
			compileSelector('a, b > c,d').alternatives.map((a) => a.compounds.length),
		).toEqual([1, 2, 1]);
	});

	it.each([
		['*', null],
		['p', 'p'],
	])('reads the type of %s', (selector, tag) => {
		expect(compileSelector(selector).alternatives[0]!.compounds[0]!.tag).toBe(tag);
	});

	it('maps every attribute operator', () => {
		const operators = compileSelector(
			'[a][b=1][c~=1][d|=1][e^=1][f$=1][g*=1]',
		).alternatives[0]!.compounds[0]!.attributes.map((a) => a.operator);
		expect(operators).toEqual([
			'exists',
			'equals',
			'includes',
			'dash',
			'prefix',
			'suffix',
			'substring',
		]);
	});

	it.each([
		['[type=text]', true],
		['[type="text" s]', false],
		['[rel~=nofollow]', true],
		['[lang|=en]', true],
		['[href=x]', false],
		['[data-type=x]', false],
		['[href=x i]', true],
	])('folds the value of %s: %s', (selector, ignoreCase) => {
		expect(
			compileSelector(selector).alternatives[0]!.compounds[0]!.attributes[0]!.ignoreCase,
		).toBe(ignoreCase);
	});

	it('ignores case only for an explicit i flag, apart from the HTML case-insensitive attributes', () => {
		const flags = compileSelector(
			'[a=1 i][b=1 s][c=1][d=1 I]',
		).alternatives[0]!.compounds[0]!.attributes.map((a) => a.ignoreCase);
		expect(flags).toEqual([true, false, false, true]);
	});

	it.each([
		[':first-child', { kind: 'child', a: 0, b: 1 }],
		[':first-of-type', { kind: 'of-type', a: 0, b: 1 }],
		[':nth-child(2n+1)', { kind: 'child', a: 2, b: 1 }],
		[':nth-child(odd)', { kind: 'child', a: 2, b: 1 }],
		[':nth-of-type(-n+3)', { kind: 'of-type', a: -1, b: 3 }],
	])('reads %s', (selector, nth) => {
		expect(compileSelector(`li${selector}`).alternatives[0]!.compounds[0]!.nth).toEqual([
			nth,
		]);
	});

	it('compiles :not() into a negated compound', () => {
		const [compound] = compileSelector('a:not(.x[y]):not(b:first-child)').alternatives[0]!
			.compounds;
		expect(compound!.negations).toEqual([
			{
				tag: null,
				attributes: [
					{ name: 'class', operator: 'includes', value: 'x', ignoreCase: false },
					{ name: 'y', operator: 'exists', value: '', ignoreCase: false },
				],
				nth: [],
			},
			{ tag: 'b', attributes: [], nth: [{ kind: 'child', a: 0, b: 1 }] },
		]);
	});

	it('trims surrounding whitespace', () => {
		expect(compileSelector('  a  ').source).toBe('a');
	});

	it.each([
		['a + b', 'adjacent'],
		['a ~ b', 'sibling'],
		['li:last-child', ':last-child needs markup that comes after the element'],
		['li:only-child', ':only-child needs markup that comes after the element'],
		['li:only-of-type', ':only-of-type needs markup that comes after the element'],
		['li:nth-last-child(1)', ':nth-last-child needs markup that comes after the element'],
		[
			'li:nth-last-of-type(1)',
			':nth-last-of-type needs markup that comes after the element',
		],
		['li:last-of-type', ':last-of-type needs markup that comes after the element'],
		['div:has(a)', ':has needs markup that comes after the element'],
		[':not(:last-child)', ':last-child needs markup that comes after the element'],
		[':not(::before)', 'pseudo-element'],
		[':not(:hover)', 'pseudo-class :hover'],
		['a || b', 'column combinator'],
		['li:nth-child(2n+1 OF .x)', 'of S'],
		[':is(a, b)', 'pseudo-class :is'],
		[':where(a)', 'pseudo-class :where'],
		['::before', 'pseudo-element'],
		['a::after', 'pseudo-element'],
		['a:hover', 'hover'],
		[':root', 'root'],
		[':empty', 'empty'],
		['svg|a', 'namespaced'],
		['*|a', 'namespaced'],
		['[a!=b]', '!='],
		['[svg|a=b]', 'namespaced'],
		[':not(a, b)', 'selector list'],
		[':not(a b)', 'combinator'],
		[':not(a > b)', 'combinator'],
		[':not(:not(a))', 'nested'],
		['li:nth-child(2n+1 of .x)', 'of S'],
		['li:nth-child(x)', 'nth-child'],
		['li:nth-child()', 'nth-child'],
		['', 'empty'],
		['   ', 'empty'],
		['div[', 'syntax'],
		['> a', 'combinator'],
		['a >', 'combinator'],
	])('rejects %j', (selector, reason) => {
		const attempt = () => compileSelector(selector);
		expect(attempt).toThrow(UnsupportedSelectorError);
		// `reason` excludes the grammar listing, which every message carries
		expect(attempt).toThrow(
			expect.objectContaining({ reason: expect.stringContaining(reason) }),
		);
		expect(attempt).toThrow(SUPPORTED_SELECTOR_GRAMMAR);
	});

	it('allows 30 compounds in a chain but not 31', () => {
		const chain = (count: number) => Array.from({ length: count }, () => 'a').join(' > ');
		expect(compileSelector(chain(30)).alternatives[0]!.compounds).toHaveLength(30);
		expect(() => compileSelector(chain(31))).toThrow(UnsupportedSelectorError);
	});

	it('allows 64 alternatives but not 65', () => {
		const list = (count: number) => Array.from({ length: count }, () => 'a').join(',');
		expect(compileSelector(list(64)).alternatives).toHaveLength(64);
		expect(() => compileSelector(list(65))).toThrow(UnsupportedSelectorError);
	});
});
