import type { ListReconcileRunEntry, ListReconcileRunsOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * List list-reconcile run audit rows from the archive, newest first.
 *
 * Surfaces the `list_reconcile_runs` table created by every successful
 * `--inventory <list>` or `--recrawl <list>` invocation so the CLI / MCP /
 * viewer can answer "when did we apply which list" without touching
 * external bookkeeping. Both invocation kinds write through the same
 * {@link import('@nitpicker/crawler').ListReconcileRunMeta} path and are
 * distinguished only by their `list_label` prefix (`inventory-`/`recrawl-`).
 * The table is append-only — see
 * {@link import('@nitpicker/crawler').ListReconcileRunMeta} for the write-side
 * contract and the rationale behind the NULL-tolerant column shape.
 *
 * Tolerates a missing `list_reconcile_runs` table: archives that predate the
 * table and read-only `stub` connections (`Archive.connect({ readOnly: true })`
 * skips migrations) both arrive here with no table. Returns
 * `{ items: [], total: 0 }` in that case rather than throwing — clients
 * call this unconditionally and a "no such table" exception would break
 * the viewer / MCP flows.
 *
 * Also tolerates missing `invalid_skipped` / `exclude_skipped` columns
 * specifically (both added after the table itself): self-healing column
 * migrations only run on a
 * writer connection (`db-ops/lifecycle/init.ts`), and this table can be
 * read from an archive that never took that path again after upgrading —
 * a `readOnly` stub connection, or a tar-cache entry whose cache key
 * (content-derived, not app-version-derived — see
 * `cache/compute-archive-cache-key.ts`) survived across the upgrade
 * without ever re-extracting. `hasColumn` is checked so this can't throw
 * "no such column" on either archive shape.
 *
 * Read-only — safe against viewer / stub-mode archives.
 * @param accessor - The archive accessor to query.
 * @param options - Pagination options.
 * @returns Paginated list of list-reconcile runs ordered by `ran_at DESC`.
 * @example
 * ```ts
 * const { items, total } = await listReconcileRuns(accessor, { limit: 10 });
 *
 * // `items.length === 0 && total === 0` covers TWO legitimate scenarios
 * // — they are indistinguishable on purpose:
 * //   1. The archive has never been through `--inventory` / `--recrawl` (empty table).
 * //   2. The archive predates the table / the connection is read-only
 * //      (table absent, `hasTable` fallback returned `[]`).
 * // Callers that need to distinguish must probe `accessor.getKnex()
 * // .schema.hasTable('list_reconcile_runs')` themselves — the public surface
 * // is deliberately kept uniform.
 *
 * for (const run of items) {
 *   console.log(`${run.ran_at}: ${run.list_label} (${run.total_lines} URLs)`);
 * }
 * ```
 */
export async function listReconcileRuns(
	accessor: ArchiveAccessor,
	options: ListReconcileRunsOptions = {},
): Promise<{ items: ListReconcileRunEntry[]; total: number }> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	// Archives that predate the table and read-only stub connections both
	// arrive here without it. Bail out with an empty result instead of
	// letting knex raise "no such table: list_reconcile_runs".
	const hasTable = await knex.schema.hasTable('list_reconcile_runs');
	if (!hasTable) {
		return { items: [], total: 0 };
	}

	const countResult = (await knex('list_reconcile_runs').count('id as total')) as {
		total: number;
	}[];
	const total = countResult[0]?.total ?? 0;

	const [hasInvalidSkipped, hasExcludeSkipped] = await Promise.all([
		knex.schema.hasColumn('list_reconcile_runs', 'invalid_skipped'),
		knex.schema.hasColumn('list_reconcile_runs', 'exclude_skipped'),
	]);

	const rows = (await knex('list_reconcile_runs')
		.select(
			'id',
			'ran_at',
			'list_label',
			'source_file_sha256',
			'total_lines',
			'new_pages',
			'new_resources',
			'scope_skipped',
			...(hasExcludeSkipped ? ['exclude_skipped'] : []),
			...(hasInvalidSkipped ? ['invalid_skipped'] : []),
			'notes',
		)
		.orderBy('ran_at', 'desc')
		.limit(limit)
		.offset(offset)) as ListReconcileRunEntry[];

	return {
		// Normalize the late-added columns to `null` when absent (rather
		// than `undefined`), matching every other optional field's
		// NULL-tolerant contract on `ListReconcileRunEntry`.
		items: rows.map((row) => ({
			...row,
			exclude_skipped: row.exclude_skipped ?? null,
			invalid_skipped: row.invalid_skipped ?? null,
		})),
		total: Number(total),
	};
}
