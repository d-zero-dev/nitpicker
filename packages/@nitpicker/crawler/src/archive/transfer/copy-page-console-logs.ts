import type { Knex } from 'knex';

import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const SRC = TRANSFER_SOURCE_ALIAS;

/**
 * Copies `page_console_logs` (one row per page/console-log occurrence)
 * for every `full`/`replace`-action page, remapping `consoleLogId`
 * through `temp.xfer_map_console_log_items`.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after
 *   `copyDictionariesForConcat`/`copyDictionariesForSplit` has populated
 *   `temp.xfer_map_console_log_items`.
 * @example
 * ```ts
 * await copyPageMeta(trx);
 * await copyPageConsoleLogs(trx);
 * ```
 */
export async function copyPageConsoleLogs(trx: Knex): Promise<void> {
	await trx.raw(`
		INSERT INTO main.page_console_logs (pageId, consoleLogId, ts)
		SELECT p.dest_id, m.dest_id, pcl.ts
		FROM ${SRC}.page_console_logs pcl
		JOIN xfer_ci_plan p ON p.src_id = pcl.pageId
			AND p.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.replace})
		JOIN xfer_map_console_log_items m ON m.src_id = pcl.consoleLogId
	`);
}
