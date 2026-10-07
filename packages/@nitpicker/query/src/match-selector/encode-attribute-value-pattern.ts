import { escapeRegExpSource } from './escape-regexp-source.js';
import { toCaseInsensitivePattern } from './to-case-insensitive-pattern.js';

/**
 * Builds the regular expression source for a selector's attribute value as
 * it appears in a serialized start tag.
 *
 * The serializer escapes `&` as `&amp;`, `"` as `&quot;` and U+00A0 as
 * `&nbsp;` character by character, so the value is encoded the same way
 * and matched against the stored text. `<` and `>` are escaped by newer
 * browsers and not by older ones, so a value containing either has no
 * single stored form and yields `null`.
 * @param value - The selector's literal attribute value.
 * @param ignoreCase - Whether ASCII letters match case-insensitively.
 * @returns The regular expression source, or `null` when the value cannot
 *   be matched against one stored form.
 * @example
 * encodeAttributeValuePattern('a&b', false); // 'a&amp;b'
 */
export function encodeAttributeValuePattern(
	value: string,
	ignoreCase: boolean,
): string | null {
	let source = '';
	for (const character of value) {
		switch (character) {
			case '<':
			case '>': {
				return null;
			}
			case '&': {
				source += '&amp;';
				break;
			}
			case '"': {
				source += '&quot;';
				break;
			}
			case '\u00A0': {
				source += '&nbsp;';
				break;
			}
			default: {
				source += ignoreCase
					? toCaseInsensitivePattern(character)
					: escapeRegExpSource(character);
			}
		}
	}
	return source;
}
