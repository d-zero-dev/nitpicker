import { decodeSerializedAttributeValue } from './decode-serialized-attribute-value.js';

const ATTRIBUTE_PATTERN =
	/([^\t\n\f\r "'/=>]+)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]+)))?/g;

/**
 * Reads the attributes out of the text between a tag name and the closing
 * `>`. Names are lower-cased, a repeated name keeps its first value (as an
 * HTML parser does), and a value-less attribute is `''`.
 * @param attrSource - The start tag text after the tag name.
 * @returns Attribute values keyed by lower-cased name.
 * @example
 * parseStartTagAttributes(' class="a b" disabled=""').get('class'); // 'a b'
 */
export function parseStartTagAttributes(attrSource: string): Map<string, string> {
	const attributes = new Map<string, string>();
	for (const match of attrSource.matchAll(ATTRIBUTE_PATTERN)) {
		const name = match[1]!.toLowerCase();
		if (attributes.has(name)) {
			continue;
		}
		const raw = match[2] ?? match[3] ?? match[4] ?? '';
		attributes.set(name, decodeSerializedAttributeValue(raw));
	}
	return attributes;
}
