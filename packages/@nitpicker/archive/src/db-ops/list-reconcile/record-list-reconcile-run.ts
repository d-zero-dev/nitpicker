import type { ListReconcileRunMeta } from '../../types.js';
import type { Knex } from 'knex';

/**
 * Appends one row to the `list_reconcile_runs` audit log.
 *
 * Called by `CrawlerOrchestrator.inventory` and `CrawlerOrchestrator.recrawl`
 * on every successful `--inventory <list>` / `--recrawl <list>` invocation
 * so the archive carries a durable record of which list was applied when
 * and at what scale — the operational question "did we apply last month's
 * list" the archive itself can answer without consulting external
 * bookkeeping.
 *
 * Append-only. There is intentionally no UPDATE path and no UNIQUE
 * constraint on `source_file_sha256`; two applies of the same list
 * each get their own row. Duplicate detection is left to readers —
 * the hash is recorded as the content-identity key they would use.
 * Field-level NULL semantics live on {@link ListReconcileRunMeta}.
 * @param knex - Knex query builder connected to the archive DB.
 * @param meta - The run metadata to record. Only `ran_at` is required.
 * @returns The autoincremented `id` of the newly-inserted row.
 */
export async function recordListReconcileRun(
	knex: Knex,
	meta: ListReconcileRunMeta,
): Promise<number> {
	const inserted = await knex
		.from('list_reconcile_runs')
		.insert({
			ran_at: meta.ran_at,
			list_label: meta.list_label ?? null,
			source_file_sha256: meta.source_file_sha256 ?? null,
			total_lines: meta.total_lines ?? null,
			new_pages: meta.new_pages ?? null,
			new_resources: meta.new_resources ?? null,
			scope_skipped: meta.scope_skipped ?? null,
			exclude_skipped: meta.exclude_skipped ?? null,
			invalid_skipped: meta.invalid_skipped ?? null,
			notes: meta.notes ?? null,
		})
		.returning('id');
	const id = inserted[0]?.id;
	if (typeof id !== 'number') {
		throw new TypeError('recordListReconcileRun: INSERT returned no row id');
	}
	return id;
}
