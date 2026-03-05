/**
 * Coerces an unknown thrown value into an `Error` instance.
 *
 * If the value is already an `Error`, it is returned as-is so that its
 * original `stack` trace and any custom properties are preserved.
 * Otherwise, the value is converted to a string and wrapped in a new `Error`.
 * @param value - The caught value to normalise.
 * @returns An `Error` instance, either the original or a newly created one.
 */
export function toError(value?: unknown): Error {
	if (value instanceof Error) {
		return value;
	}
	return new Error(String(value));
}
