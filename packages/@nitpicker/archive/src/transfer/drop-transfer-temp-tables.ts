import type { Knex } from 'knex';

import { TRANSFER_DICTIONARY_TABLES } from './transfer-dictionary-tables.js';

/**
 * Drops every temp table
 * {@link import('./create-transfer-temp-tables.js').createTransferTempTables}
 * created, so the next source starts from a clean slate. Safe to call even
 * if creation only partially succeeded (`IF EXISTS`).
 * @param knex - Knex query builder connected to the destination archive DB.
 */
export async function dropTransferTempTables(knex: Knex): Promise<void> {
	await knex.raw('DROP TABLE IF EXISTS xfer_ci_plan');
	await knex.raw('DROP TABLE IF EXISTS xfer_ci_in_scope');
	await knex.raw('DROP TABLE IF EXISTS xfer_ci_ref');
	await knex.raw('DROP TABLE IF EXISTS xfer_ri_plan');
	for (const table of TRANSFER_DICTIONARY_TABLES) {
		await knex.raw(`DROP TABLE IF EXISTS xfer_need_${table}`);
		await knex.raw(`DROP TABLE IF EXISTS xfer_map_${table}`);
	}
}
