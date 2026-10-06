import type { AttributeOperator } from './types.js';

import { describe, expect, it } from 'vitest';

import { matchesAttributeTest } from './matches-attribute-test.js';

/**
 * Evaluates one attribute test against an element that has (or lacks) the attribute `x`.
 * @param operator - The attribute operator.
 * @param value - The selector's attribute value.
 * @param actual - The element's attribute value, or `undefined` when absent.
 * @param ignoreCase - Whether the test ignores ASCII case.
 */
function check(
	operator: AttributeOperator,
	value: string,
	actual: string | undefined,
	ignoreCase = false,
) {
	return matchesAttributeTest(
		{ name: 'x', operator, value, ignoreCase },
		new Map(actual === undefined ? [] : [['x', actual]]),
	);
}

describe('matchesAttributeTest', () => {
	it.each([
		['exists', '', '', true],
		['exists', '', undefined, false],
		['equals', 'a', 'a', true],
		['equals', 'a', 'ab', false],
		['equals', '', '', true],
		['equals', 'a', undefined, false],
		['includes', 'b', 'a b c', true],
		['includes', 'b', 'a bc', false],
		['includes', 'b', 'a\tb', true],
		['includes', 'a b', 'a b', false],
		['includes', '', 'a', false],
		['dash', 'en', 'en', true],
		['dash', 'en', 'en-US', true],
		['dash', 'en', 'english', false],
		['dash', '', '', true],
		['dash', '', '-x', true],
		['prefix', 'ab', 'abc', true],
		['prefix', 'bc', 'abc', false],
		['prefix', '', 'abc', false],
		['suffix', 'bc', 'abc', true],
		['suffix', 'ab', 'abc', false],
		['suffix', '', 'abc', false],
		['substring', 'b', 'abc', true],
		['substring', 'd', 'abc', false],
		['substring', '', 'abc', false],
	] as [AttributeOperator, string, string | undefined, boolean][])(
		'%s %j against %j → %s',
		(operator, value, actual, expected) => {
			expect(check(operator, value, actual)).toBe(expected);
		},
	);

	it('folds ASCII case only when asked', () => {
		expect(check('equals', 'ABC', 'abc', true)).toBe(true);
		expect(check('equals', 'ABC', 'abc')).toBe(false);
		expect(check('prefix', 'AB', 'abc', true)).toBe(true);
		expect(check('includes', 'B', 'a b', true)).toBe(true);
	});

	it('does not fold non-ASCII letters', () => {
		expect(check('equals', 'É', 'é', true)).toBe(false);
	});

	it('treats a no-break space as part of a word, not as a separator', () => {
		expect(check('includes', 'a b', 'x a b y')).toBe(true);
		expect(check('includes', 'a', 'a b')).toBe(false);
	});
});
