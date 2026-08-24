/**
 * Groups `(id, value)` rows into a `Map<id, value[]>`, appending to an
 * existing bucket if one is already present for that id.
 *
 * Shared by every `report-export/` function that fans one row out to a list
 * of values per key (referrer URL lookups, redirect-from lookups) — each of
 * those queries differs only in the SQL, not in how the result rows get
 * grouped.
 * @param rows - Rows to group, each contributing one value under one id.
 * @param getId - Extracts the grouping id from a row.
 * @param getValue - Extracts the value to append from a row.
 * @returns Map from id to every value observed for it, in row order. An id
 *   with no matching row has no entry.
 * @example
 * const rows = [{ destId: 1, url: 'a' }, { destId: 1, url: 'b' }];
 * groupValuesById(rows, (r) => r.destId, (r) => r.url);
 * // Map(1) { 1 => ['a', 'b'] }
 */
export function groupValuesById<Row, Value>(
	rows: readonly Row[],
	getId: (row: Row) => number,
	getValue: (row: Row) => Value,
): Map<number, Value[]> {
	const result = new Map<number, Value[]>();
	for (const row of rows) {
		const id = getId(row);
		const bucket = result.get(id);
		if (bucket) {
			bucket.push(getValue(row));
		} else {
			result.set(id, [getValue(row)]);
		}
	}
	return result;
}
