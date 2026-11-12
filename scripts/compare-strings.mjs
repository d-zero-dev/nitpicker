/**
 * Orders two strings by UTF-16 code unit, which is what `Array#sort()` does
 * without a comparator. Written out so callers can pass a comparator
 * explicitly (`toSorted(compareStrings)`) and still get the locale-independent
 * order that makes dumps and expectations reproducible.
 * @param {string} a - Left string.
 * @param {string} b - Right string.
 * @returns {number} Negative when `a` sorts first, positive when `b` does, 0 when equal.
 * @example
 * ['b', 'B', 'a'].toSorted(compareStrings); // ['B', 'a', 'b']
 */
export function compareStrings(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}
