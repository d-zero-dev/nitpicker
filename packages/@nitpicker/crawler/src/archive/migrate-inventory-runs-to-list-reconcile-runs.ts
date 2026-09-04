import type { Knex } from 'knex';

/**
 * Renames the legacy `inventory_runs` table to `list_reconcile_runs` for
 * archives created before the rename (issue #354: the old name implied
 * `--inventory`-only despite `--recrawl` writing to the same table via the
 * same {@link import('./db-ops/list-reconcile/record-list-reconcile-run.js').recordListReconcileRun}
 * path).
 *
 * Must run BEFORE {@link import('./init-schema.js').initSchema} in the boot
 * sequence, not alongside the other column-adding `migrate*` functions
 * that run after it. `initSchema` unconditionally re-runs
 * `createAdjunctTables`, which creates `list_reconcile_runs` fresh
 * (`CREATE TABLE IF NOT EXISTS`) if it doesn't see the new name yet — so if
 * this rename ran after `initSchema`, it would find `list_reconcile_runs`
 * already present (empty) and skip, silently orphaning the old table's
 * rows. Running first guarantees `initSchema` sees the already-renamed
 * table and its `IF NOT EXISTS` guard is a no-op.
 *
 * A straight `renameTable` (not the convert-then-drop pattern used for
 * `page_tags` → `technology_signals`/`page_technologies`) because this is a
 * pure name change with no data-shape change — the row shape is identical
 * before and after.
 *
 * Idempotent: a no-op once `inventory_runs` is gone (either because this
 * function already ran, or the archive was created after the rename
 * shipped and never had the old name).
 * @param instance - The Knex query builder instance connected to the database.
 * @param onLog - Called instead of `console.error` when this migration
 *   actually applies (issue #294: a bare `console.error` here can fire
 *   while a `@d-zero/dealer` `Lanes`/`TaskList` display is mid-redraw during
 *   `Archive.open`, corrupting its cursor tracking). Falls back to
 *   `console.error` when omitted (direct/test callers).
 */
export async function migrateInventoryRunsToListReconcileRuns(
	instance: Knex,
	onLog?: (message: string) => void,
): Promise<void> {
	const hasOldTable = await instance.schema.hasTable('inventory_runs');
	if (!hasOldTable) {
		return;
	}
	const hasNewTable = await instance.schema.hasTable('list_reconcile_runs');
	if (hasNewTable) {
		return;
	}
	await instance.schema.renameTable('inventory_runs', 'list_reconcile_runs');
	const message = '[migrate] inventory_runs renamed to list_reconcile_runs';
	if (onLog) {
		onLog(message);
	} else {
		// eslint-disable-next-line no-console
		console.error(message);
	}
}
