/**
 * Returns a read-model row without the columns that legitimately differ
 * between two builds of the same archive, so two builds can be compared
 * byte for byte: `viewer_read_model_meta.built_at` (a wall-clock timestamp)
 * and the `__rowid` helper column `buildKeysetQuery` adds.
 * @param {string} table - The table the row came from.
 * @param {Record<string, unknown>} row - The row as read.
 * @returns {Record<string, unknown>} A copy of the row without those columns.
 * @example
 * normalizeReadModelRow('viewer_read_model_meta', { id: 1, built_at: 1700000000000 });
 * // { id: 1 }
 */
export function normalizeReadModelRow(table, row) {
	const copy = { ...row };
	delete copy.__rowid;
	if (table === 'viewer_read_model_meta') {
		delete copy.built_at;
	}
	return copy;
}
