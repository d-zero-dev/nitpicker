import type { AttributeTest } from './types.js';

const ASCII_WHITESPACE = /[\t\n\f\r ]+/;

/**
 * Lower-cases ASCII letters only, matching how selectors fold attribute
 * values for the `i` flag.
 * @param text - The text to fold.
 * @returns The folded text.
 */
function foldAscii(text: string): string {
	return text.replaceAll(/[A-Z]/g, (character) => character.toLowerCase());
}

/**
 * Evaluates one attribute selector against an element's decoded
 * attributes. An empty value never matches `^=`, `$=`, `*=` or `~=`, and a
 * `~=` value containing whitespace never matches, as in CSS.
 * @param test - The compiled attribute condition.
 * @param attributes - The element's decoded attributes by lower-cased name.
 * @returns `true` when the element satisfies the condition.
 * @example
 * matchesAttributeTest(
 *   { name: 'href', operator: 'prefix', value: '/a', ignoreCase: false },
 *   new Map([['href', '/a/b']]),
 * ); // true
 */
export function matchesAttributeTest(
	test: AttributeTest,
	attributes: ReadonlyMap<string, string>,
): boolean {
	const actualRaw = attributes.get(test.name);
	if (actualRaw === undefined) {
		return false;
	}
	if (test.operator === 'exists') {
		return true;
	}
	if (
		test.value === '' &&
		(test.operator === 'prefix' ||
			test.operator === 'suffix' ||
			test.operator === 'substring' ||
			test.operator === 'includes')
	) {
		return false;
	}
	if (test.operator === 'includes' && ASCII_WHITESPACE.test(test.value)) {
		return false;
	}
	const actual = test.ignoreCase ? foldAscii(actualRaw) : actualRaw;
	const expected = test.ignoreCase ? foldAscii(test.value) : test.value;
	switch (test.operator) {
		case 'equals': {
			return actual === expected;
		}
		case 'includes': {
			return actual.split(ASCII_WHITESPACE).includes(expected);
		}
		case 'dash': {
			return actual === expected || actual.startsWith(`${expected}-`);
		}
		case 'prefix': {
			return actual.startsWith(expected);
		}
		case 'suffix': {
			return actual.endsWith(expected);
		}
		case 'substring': {
			return actual.includes(expected);
		}
	}
}
