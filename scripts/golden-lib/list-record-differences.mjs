/**
 * Lists the keys on which two string maps disagree: present on one side
 * only, or present on both with different values.
 * @param {Record<string, string>} expected - The golden map.
 * @param {Record<string, string>} actual - The fresh map.
 * @returns {string[]} The differing keys, in code-unit order.
 * @example
 * listRecordDifferences({ a: '1', b: '2' }, { a: '1', c: '3' }); // ['b', 'c']
 */
export function listRecordDifferences(expected, actual) {
	return [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
		.toSorted()
		.filter((key) => !Object.hasOwn(expected, key) || expected[key] !== actual[key]);
}
