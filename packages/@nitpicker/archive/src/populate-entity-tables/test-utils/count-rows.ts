import type { Knex } from 'knex';

/**
 * Runs `SELECT count(<countColumn>) FROM <table>` and returns the count
 * as a plain JS number. Kept in this package instead of importing from
 * `populate-ref-tables/test-utils/count-rows.ts` because a spec in populate-entities importing
 * from populate-refs test-utils would establish a cross-directory test-utils
 * dependency; the populate-refs copy has the same shape but its default
 * countColumn is scoped to that phase's tables. Duplication is minimal
 * and keeps each phase's test scaffolding self-contained.
 * @param db - Knex instance (typically a spec-local in-memory DB).
 * @param table - Table name.
 * @param countColumn - Column to count; defaults to `'*'` so this helper
 *   works uniformly across `content_items` / `page_meta` /
 *   `resource_ref_edges` (some of which do not have an `id` column).
 * @returns Row count.
 */
export async function countRows(
	db: Knex,
	table: string,
	countColumn: string = '*',
): Promise<number> {
	const rows = await db(table).count<{ n: number }[]>({ n: countColumn });
	const first = rows[0]!;
	return Number(first.n);
}
