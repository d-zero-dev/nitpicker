import { toCaseInsensitivePattern } from './to-case-insensitive-pattern.js';

const END_TAG_PATTERNS = new Map<string, RegExp>();

/**
 * Finds where the content of a raw text element ends: just after the
 * first `</name` that is followed by whitespace, `/` or `>`, through that
 * end tag's `>`. `plaintext` and an element with no end tag run to the end
 * of the document.
 * @param options - The document and where to read.
 * @param options.html - The document.
 * @param options.name - The lower-cased element name.
 * @param options.from - The index just after the element's start tag.
 * @returns The index just after the end tag, or `html.length`.
 * @example
 * findRawTextElementEnd({ html: '<script>a<b</script><i>', name: 'script', from: 8 }); // 19
 */
export function findRawTextElementEnd(options: {
	readonly html: string;
	readonly name: string;
	readonly from: number;
}): number {
	const { html, name, from } = options;
	if (name === 'plaintext') {
		return html.length;
	}
	let pattern = END_TAG_PATTERNS.get(name);
	if (!pattern) {
		pattern = new RegExp(`</${toCaseInsensitivePattern(name)}(?=[ \\t\\n\\r\\f/>])`, 'g');
		END_TAG_PATTERNS.set(name, pattern);
	}
	pattern.lastIndex = from;
	const match = pattern.exec(html);
	if (!match) {
		return html.length;
	}
	const close = html.indexOf('>', match.index + match[0].length);
	return close === -1 ? html.length : close + 1;
}
