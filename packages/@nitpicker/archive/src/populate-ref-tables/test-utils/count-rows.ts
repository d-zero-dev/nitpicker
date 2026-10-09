import type { Knex } from 'knex';

/**
 * Runs `SELECT count(?) FROM <table>` and returns the count as a plain
 * JS number. Exists purely to keep spec files inside populate-ref-tables/ compliant
 * with `unicorn/no-await-expression-member` — inlining
 * `Number((await db(t).count(...))[0]!.n)` reads fine but violates the
 * rule at every callsite.
 * @param db - Knex instance (typically a spec-local in-memory DB).
 * @param table - Table name.
 * @param countColumn - Column to count; defaults to `'id'` because every
 *   populate-refs table except `header_set_entries` / `header_flags` uses
 *   that PK name. Pass `'header_set_id'` for the two exceptions.
 * @returns Row count.
 */
export async function countRows(
	db: Knex,
	table: string,
	countColumn = 'id',
): Promise<number> {
	const rows = await db(table).count<{ n: number }[]>({ n: countColumn });
	return Number(rows[0]!.n);
}
