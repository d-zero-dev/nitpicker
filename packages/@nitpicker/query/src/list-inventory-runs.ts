import type { InventoryRunEntry, ListInventoryRunsOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * List inventory run audit rows from the archive, newest first.
 *
 * Surfaces the `inventory_runs` table created by every successful
 * `--inventory <list>` invocation so the CLI / MCP / viewer can answer
 * "when did we apply which deploy list" without touching external
 * bookkeeping. The table is append-only at Phase 1 — see
 * {@link import('@nitpicker/crawler').InventoryRunMeta} for the write-side
 * contract and the rationale behind the NULL-tolerant column shape.
 *
 * Tolerates a missing `inventory_runs` table: pre-Phase-1 archives and
 * read-only `stub` connections (`Archive.connect({ readOnly: true })`
 * skips migrations) both arrive here with no table. Returns
 * `{ items: [], total: 0 }` in that case rather than throwing — clients
 * call this unconditionally and a "no such table" exception would break
 * the viewer / MCP flows.
 *
 * Read-only — safe against viewer / stub-mode archives.
 * @param accessor - The archive accessor to query.
 * @param options - Pagination options.
 * @returns Paginated list of inventory runs ordered by `ran_at DESC`.
 * @example
 * ```ts
 * const { items, total } = await listInventoryRuns(accessor, { limit: 10 });
 *
 * // `items.length === 0 && total === 0` covers TWO legitimate scenarios
 * // — they are indistinguishable on purpose:
 * //   1. The archive has never been through `--inventory` (empty table).
 * //   2. The archive predates Phase 1 / the connection is read-only
 * //      (table absent, `hasTable` fallback returned `[]`).
 * // Callers that need to distinguish must probe `accessor.getKnex()
 * // .schema.hasTable('inventory_runs')` themselves — Phase 1 keeps the
 * // public surface uniform.
 *
 * for (const run of items) {
 *   console.log(`${run.ran_at}: ${run.list_label} (${run.total_lines} URLs)`);
 * }
 * ```
 */
export async function listInventoryRuns(
	accessor: ArchiveAccessor,
	options: ListInventoryRunsOptions = {},
): Promise<{ items: InventoryRunEntry[]; total: number }> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	// Pre-Phase-1 archives and read-only stub connections both arrive
	// here without the table. Bail out with an empty result instead of
	// letting knex raise "no such table: inventory_runs".
	const hasTable = await knex.schema.hasTable('inventory_runs');
	if (!hasTable) {
		return { items: [], total: 0 };
	}

	const countResult = (await knex('inventory_runs').count('id as total')) as {
		total: number;
	}[];
	const total = countResult[0]?.total ?? 0;

	const rows = (await knex('inventory_runs')
		.select(
			'id',
			'ran_at',
			'list_label',
			'source_file_sha256',
			'total_lines',
			'new_pages',
			'new_resources',
			'scope_skipped',
			'notes',
		)
		.orderBy('ran_at', 'desc')
		.limit(limit)
		.offset(offset)) as InventoryRunEntry[];

	return {
		items: rows,
		total: Number(total),
	};
}
