/**
 * Orders two strings by UTF-16 code unit, which is what `Array#sort()` does
 * without a comparator. Written out so E2E tests can pass a comparator
 * explicitly (`toSorted(compareStrings)`) and still get the locale-independent
 * order that makes expectations reproducible.
 * @param a - Left string.
 * @param b - Right string.
 * @returns Negative when `a` sorts first, positive when `b` does, 0 when equal.
 * @example
 * ['b', 'B', 'a'].toSorted(compareStrings); // ['B', 'a', 'b']
 */
export function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
