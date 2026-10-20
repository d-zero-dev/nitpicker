import type { AttributeTest, ComplexSelector } from './types.js';

const ASCII_WHITESPACE = /[\t\n\f\r ]/;
const MARKUP_BRACKET = /[<>]/;

/**
 * Whether an attribute test can be judged against the value as one fixed
 * stored form. A value containing `<` or `>` cannot: older serializers wrote
 * them as they are, newer ones escape them, so the stored text of the same
 * attribute depends on the browser that saved it, and only the stack, which
 * decodes values, is trusted with it. A test that can never match (an empty
 * value for `^=`, `$=`, `*=`, `~=`; a `~=` value with whitespace) and an
 * existence test do not look at the value.
 * @param test - The attribute condition.
 * @returns `true` when the value is irrelevant or has one stored form.
 */
function hasOneStoredForm(test: AttributeTest): boolean {
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
		return true;
	}
	if (test.operator === 'includes' && ASCII_WHITESPACE.test(test.value)) {
		return true;
	}
	return !MARKUP_BRACKET.test(test.value);
}

/**
 * Whether one start tag settles a comma alternative, so it can be tried by
 * reading start tags alone before the open-element stack runs: a single
 * compound (no combinator), no sibling-position test (`:nth-*`, `:first-*`,
 * also inside `:not()`), and every attribute value — also those inside
 * `:not()` — having one stored form.
 *
 * Which stage decides an alternative is part of the result the command
 * reports (`tokenizedSnapshots`), so this condition is a contract, not an
 * optimization to be widened.
 * @param selector - One comma alternative.
 * @returns `true` when the alternative is decided by a single start tag.
 * @example
 * isDecidableFromOneStartTag(compileSelector('img[alt]').alternatives[0]!); // true
 * isDecidableFromOneStartTag(compileSelector('nav a').alternatives[0]!); // false
 */
export function isDecidableFromOneStartTag(selector: ComplexSelector): boolean {
	const [compound, ...rest] = selector.compounds;
	if (compound === undefined || rest.length > 0) {
		return false;
	}
	const conditions = [compound, ...compound.negations];
	return conditions.every(
		(condition) =>
			condition.nth.length === 0 && condition.attributes.every(hasOneStoredForm),
	);
}
