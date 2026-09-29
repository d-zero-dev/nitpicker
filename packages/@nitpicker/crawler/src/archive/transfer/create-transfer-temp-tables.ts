import type { Knex } from 'knex';

import { TRANSFER_DICTIONARY_TABLES } from './transfer-dictionary-tables.js';

/**
 * Creates every `temp.xfer_*` table one source's transfer needs: the
 * `content_items` / `resource_items` plans (per-row action + resolved
 * destination id), the in-scope/referenced staging tables split's plan
 * computation uses, and one `(src_id PRIMARY KEY)` need-table plus one
 * `(src_id PRIMARY KEY, dest_id)` map-table per dictionary in
 * {@link TRANSFER_DICTIONARY_TABLES}.
 *
 * Must run on the SAME connection {@link import('./attach-source-database.js').attachSourceDatabase}
 * attached the source to (SQLite `TEMP` tables are connection-scoped, not
 * transaction-scoped) — and, unlike `ATTACH`, is safe to run either inside
 * or outside a transaction. Called once per source, paired with
 * {@link import('./drop-transfer-temp-tables.js').dropTransferTempTables}
 * after that source's transaction commits, so a second source's plan
 * starts from empty tables rather than accumulating the previous source's
 * rows.
 * @param knex - Knex query builder connected to the destination archive DB
 *   (the connection the temp tables attach to).
 * @example
 * ```ts
 * await createTransferTempTables(knex);
 * try {
 *   await knex.transaction(async (trx) => { ... });
 * } finally {
 *   await dropTransferTempTables(knex);
 * }
 * ```
 */
export async function createTransferTempTables(knex: Knex): Promise<void> {
	await knex.raw(`
		CREATE TEMP TABLE xfer_ci_plan (
			src_id INTEGER PRIMARY KEY,
			action INTEGER NOT NULL,
			dest_id INTEGER
		)
	`);
	await knex.raw(`
		CREATE TEMP TABLE xfer_ci_in_scope (
			src_id INTEGER PRIMARY KEY
		)
	`);
	await knex.raw(`
		CREATE TEMP TABLE xfer_ci_ref (
			src_id INTEGER PRIMARY KEY
		)
	`);
	await knex.raw(`
		CREATE TEMP TABLE xfer_ri_plan (
			src_id INTEGER PRIMARY KEY,
			action INTEGER NOT NULL,
			dest_id INTEGER
		)
	`);
	for (const table of TRANSFER_DICTIONARY_TABLES) {
		await knex.raw(`CREATE TEMP TABLE xfer_need_${table} (src_id INTEGER PRIMARY KEY)`);
		await knex.raw(
			`CREATE TEMP TABLE xfer_map_${table} (src_id INTEGER PRIMARY KEY, dest_id INTEGER NOT NULL)`,
		);
	}
}
