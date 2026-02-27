/**
 * Creates a shallow copy of an object with all `undefined`-valued properties removed.
 * If the input is falsy (e.g., `undefined` or `null`), returns an empty object.
 * @template T - The type of the input object.
 * @param obj - The object to clean. If falsy, an empty `Partial<T>` is returned.
 * @returns A new object containing only the properties whose values are not `undefined`.
 */
export function cleanObject<T extends Record<string, unknown>>(obj?: T) {
	if (!obj) {
		return {} as Partial<T>;
	}
	return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
