import type { AttributeTest } from './types.js';

import { encodeAttributeValuePattern } from './encode-attribute-value-pattern.js';
import { START_TAG_PATTERNS } from './start-tag-patterns.js';
import { toCaseInsensitivePattern } from './to-case-insensitive-pattern.js';

const { whitespace, nameCharacters, attributeSkip, codewordSequence } =
	START_TAG_PATTERNS;

/** Matches nothing: an empty negative lookahead always fails. */
const NEVER = '(?!)';

/**
 * Builds the body of a lookahead, to be placed right after the `<` of a
 * start tag, that holds when the tag carries an attribute satisfying
 * `test`.
 *
 * The attribute value is matched in its serialized (entity-encoded) form.
 * Because the serializer escapes character by character, encoding the
 * selector's value gives the exact stored text; `$=` and `*=` additionally
 * anchor the start of the value to an entity boundary
 * (`START_TAG_PATTERNS.codewordSequence`), since encoding alone is not
 * enough — `[title*=amp]` must not match inside a stored `&amp;`.
 * @param test - The compiled attribute condition.
 * @returns The lookahead body, or `null` when the value has no single
 *   stored form (it contains `<` or `>`).
 * @example
 * buildAttributeLookahead({ name: 'href', operator: 'prefix', value: '/a', ignoreCase: false });
 */
export function buildAttributeLookahead(test: AttributeTest): string | null {
	const upToAttribute = `${nameCharacters}+${attributeSkip}*?${whitespace}${toCaseInsensitivePattern(test.name)}`;
	if (test.operator === 'exists') {
		return `${upToAttribute}(?=[ \\t\\n\\r\\f/>=])`;
	}
	if (
		test.value === '' &&
		(test.operator === 'prefix' ||
			test.operator === 'suffix' ||
			test.operator === 'substring' ||
			test.operator === 'includes')
	) {
		return NEVER;
	}
	if (test.operator === 'includes' && /[\t\n\f\r ]/.test(test.value)) {
		return NEVER;
	}
	const encoded = encodeAttributeValuePattern(test.value, test.ignoreCase);
	if (encoded === null) {
		return null;
	}
	switch (test.operator) {
		case 'equals': {
			return `${upToAttribute}="${encoded}"`;
		}
		case 'prefix': {
			return `${upToAttribute}="${encoded}`;
		}
		case 'suffix': {
			return `${upToAttribute}="${codewordSequence}${encoded}"`;
		}
		case 'substring': {
			return `${upToAttribute}="${codewordSequence}${encoded}`;
		}
		case 'includes': {
			return `${upToAttribute}="(?:[^"]*${whitespace})?${encoded}(?=${whitespace}|")`;
		}
		case 'dash': {
			return `${upToAttribute}="${encoded}(?:-|")`;
		}
	}
}
