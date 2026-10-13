/**
 * Builds an object whose keys are in code-unit order, so two dumps of the
 * same classification serialize identically whatever order the rows came
 * back in.
 * @param {[string, string][]} entries - Key/value pairs (keys unique).
 * @returns {Record<string, string>} The object.
 * @example
 * sortedRecord([['b', '1'], ['a', '2']]); // { a: '2', b: '1' }
 */
export function sortedRecord(entries) {
	return Object.fromEntries(entries.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
