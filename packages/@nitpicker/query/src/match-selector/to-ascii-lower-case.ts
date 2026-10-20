/**
 * Lower-cases ASCII letters only. HTML's tag and attribute names ignore
 * ASCII case and nothing else, but `String#toLowerCase` also maps U+212A
 * (Kelvin sign) to `k` and U+0130 to `i` plus a combining dot, so a selector
 * folded with it would match names the document's own names do not.
 * @param text - The name to fold.
 * @returns The name with `A`–`Z` lower-cased.
 * @example
 * toAsciiLowerCase('DIV'); // 'div'
 * toAsciiLowerCase('linK'); // 'linK', not 'link'
 */
export function toAsciiLowerCase(text: string): string {
	return text.replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase());
}
