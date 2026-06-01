/**
 * Parses an optional query-string value into a number.
 * @param value - The raw query-string value (or `undefined` if absent).
 * @returns The parsed number, or `undefined` if the value is absent/empty.
 * @throws {TypeError} If the value is present but not a valid number.
 */
export function toNumber(value?: string): number | undefined {
	if (value == null || value === '') {
		return undefined;
	}
	const num = Number(value);
	if (Number.isNaN(num)) {
		throw new TypeError(`Invalid number: ${value}`);
	}
	return num;
}
