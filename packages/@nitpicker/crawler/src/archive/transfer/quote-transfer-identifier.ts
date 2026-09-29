/**
 * Double-quotes a bare SQL identifier (`"order"`, not `order`) so a column
 * name that happens to collide with a SQLite keyword (`order`, `key`,
 * `references`, …) never breaks a transfer statement built by
 * interpolating {@link import('./list-transfer-columns.js').listTransferColumns}'
 * output directly into raw SQL — every generic (not hand-written)
 * column-list builder in `archive/transfer/` must quote through this
 * function rather than splicing bare names.
 * @param name - A bare, trusted column or table identifier (never
 *   user-supplied — every caller sources `name` from `pragma_table_info`
 *   against this codebase's own fixed schema).
 * @returns The identifier wrapped in double quotes.
 * @example
 * ```ts
 * columns.map(quoteTransferIdentifier).join(', ') // '"id", "order", "text"'
 * ```
 */
export function quoteTransferIdentifier(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}
