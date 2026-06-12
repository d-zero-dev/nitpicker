/**
 * Parses an optional query-string value into a boolean.
 *
 * Accepts only the literal strings `"true"` and `"false"`. Absent/empty values
 * yield `undefined` so the corresponding filter is left unset.
 * @param value - The raw query-string value (or `undefined` if absent).
 * @returns `true`/`false`, or `undefined` if the value is absent/empty.
 * @throws {TypeError} If the value is present but not `"true"` or `"false"`.
 */
export function toBoolean(value?: string): boolean | undefined {
	if (value == null || value === '') {
		return undefined;
	}
	if (value === 'true') {
		return true;
	}
	if (value === 'false') {
		return false;
	}
	throw new TypeError(`Invalid boolean: ${value}`);
}
