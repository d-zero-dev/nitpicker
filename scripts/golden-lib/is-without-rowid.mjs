/**
 * Whether a table's `CREATE TABLE` statement (as `sqlite_master.sql` stores it)
 * declares it `WITHOUT ROWID`. The clause is a table option, so it follows the
 * closing parenthesis of the column list (table options are comma-separated);
 * looking only there keeps a column named `without_rowid`, or the words inside
 * a default value, from being read as the option.
 * @param {string | null | undefined} sql - The statement, or nothing for an object without one.
 * @returns {boolean} `true` for a `WITHOUT ROWID` table.
 * @example
 * isWithoutRowid('CREATE TABLE t (a integer primary key) WITHOUT ROWID'); // true
 * isWithoutRowid('CREATE TABLE t (id integer primary key)'); // false
 */
export function isWithoutRowid(sql) {
	if (!sql) {
		return false;
	}
	const closing = sql.lastIndexOf(')');
	if (closing === -1) {
		return false;
	}
	return sql
		.slice(closing + 1)
		.replaceAll(';', '')
		.split(',')
		.some(
			(option) => option.trim().split(/\s+/).join(' ').toUpperCase() === 'WITHOUT ROWID',
		);
}
