const ENTITIES: Readonly<Record<string, string>> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	nbsp: '\u00A0',
};

/**
 * Decodes the five entities the HTML serializer writes inside attribute
 * values in a single pass, so `&amp;lt;` becomes `&lt;` and not `<`.
 * Any other `&` is left as is.
 * @param value - The attribute value as stored.
 * @returns The decoded value.
 * @example
 * decodeSerializedAttributeValue('/?a=1&amp;b=2'); // '/?a=1&b=2'
 */
export function decodeSerializedAttributeValue(value: string): string {
	if (!value.includes('&')) {
		return value;
	}
	return value.replaceAll(/&(amp|lt|gt|quot|nbsp);/g, (_match, name: string) => {
		return ENTITIES[name]!;
	});
}
