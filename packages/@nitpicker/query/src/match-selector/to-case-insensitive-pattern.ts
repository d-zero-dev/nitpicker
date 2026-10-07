import { escapeRegExpSource } from './escape-regexp-source.js';

/**
 * Builds a regular expression source that matches `text` ignoring ASCII
 * case, without the `i` flag: only ASCII letters become `[xX]` classes, so
 * the surrounding pattern (and any entity text) stays case-sensitive and a
 * Unicode letter is never folded.
 * @param text - The literal text.
 * @returns The regular expression source.
 * @example
 * toCaseInsensitivePattern('a-b'); // '[aA]-[bB]'
 */
export function toCaseInsensitivePattern(text: string): string {
	let source = '';
	for (const character of text) {
		const lower = character.toLowerCase();
		const upper = character.toUpperCase();
		source +=
			lower !== upper && character.length === 1 && character < '\u0080'
				? `[${lower}${upper}]`
				: escapeRegExpSource(character);
	}
	return source;
}
