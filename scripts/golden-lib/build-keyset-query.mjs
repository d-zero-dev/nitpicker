import { quoteIdentifier } from './quote-identifier.mjs';

/**
 * Builds the SQL that reads the next chunk of a table in its defined order,
 * so a table of millions of rows can be walked without `OFFSET` (whose cost
 * grows with the offset) or loading it whole.
 *
 * A rowid table is read in `rowid` order and its rowid is exposed as
 * `__rowid`, because the order a rowid table keeps its rows in (insertion
 * order) is part of what a golden check has to pin, and not every such table
 * has the rowid among its columns. A `WITHOUT ROWID` table is read in
 * primary-key order, which is how SQLite stores it, so its rows carry the key
 * themselves.
 * @param {object} options - Query options.
 * @param {string} options.table - The table to read.
 * @param {string[] | undefined} options.keyColumns - The primary-key
 *   columns of a `WITHOUT ROWID` table, in key order; `undefined` for a rowid table.
 * @param {number} options.chunkSize - Rows per chunk.
 * @param {unknown[] | undefined} options.afterKey - The key of the last
 *   row already read (one value per key column, or `[rowid]`); `undefined` for the first chunk.
 * @returns {{ sql: string, bindings: unknown[] }} The statement and its bindings.
 * @throws {Error} When `afterKey` does not have one value per key column.
 * @example
 * buildKeysetQuery({ table: 'viewer_pages', keyColumns: undefined, chunkSize: 10, afterKey: [5] });
 * // { sql: 'SELECT rowid AS "__rowid", * FROM "viewer_pages" WHERE rowid > ? ORDER BY rowid LIMIT ?', bindings: [5, 10] }
 */
export function buildKeysetQuery({ table, keyColumns, chunkSize, afterKey }) {
	const isRowidTable = keyColumns === undefined;
	const keys = isRowidTable ? ['rowid'] : keyColumns.map((name) => quoteIdentifier(name));
	if (afterKey !== undefined && afterKey.length !== keys.length) {
		throw new Error(
			`afterKey has ${afterKey.length} values but the key has ${keys.length} columns`,
		);
	}
	const select = isRowidTable ? 'SELECT rowid AS "__rowid", *' : 'SELECT *';
	const from = `FROM ${quoteIdentifier(table)}`;
	const order = `ORDER BY ${keys.join(', ')}`;
	if (afterKey === undefined) {
		return { sql: `${select} ${from} ${order} LIMIT ?`, bindings: [chunkSize] };
	}
	const left = keys.length === 1 ? keys[0] : `(${keys.join(', ')})`;
	const right = keys.length === 1 ? '?' : `(${keys.map(() => '?').join(', ')})`;
	return {
		sql: `${select} ${from} WHERE ${left} > ${right} ${order} LIMIT ?`,
		bindings: [...afterKey, chunkSize],
	};
}
