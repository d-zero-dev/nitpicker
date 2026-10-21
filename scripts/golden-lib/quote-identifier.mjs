/**
 * Quotes an SQLite identifier (a table or column name) for use in a statement.
 * The golden scripts read table and column names from the archive being
 * checked (`sqlite_master`, `PRAGMA table_info`), so the names come from a
 * file, not from the script; quoting with embedded quotes doubled keeps any
 * name inside one identifier.
 * @param {string} name - A table or column name.
 * @returns {string} The name in double quotes, with embedded quotes doubled.
 * @example
 * quoteIdentifier('viewer_pages'); // '"viewer_pages"'
 * quoteIdentifier('a"b'); // '"a""b"'
 */
export function quoteIdentifier(name) {
	return `"${name.replaceAll('"', '""')}"`;
}
