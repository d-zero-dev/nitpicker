import type { Knex } from 'knex';

import { listTransferColumns } from './list-transfer-columns.js';
import { quoteTransferIdentifier } from './quote-transfer-identifier.js';
import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const SRC = TRANSFER_SOURCE_ALIAS;

/**
 * Copies `analysis_violations` for every `full`/`replace`-action page,
 * remapping `message_text_id` (required) and `code_text_id` (nullable)
 * through `temp.xfer_map_analysis_text_refs`. Every other column
 * (`validator`/`severity`/`rule`/the three `*_sort_key` strings/`line`/
 * `col`) passes through unchanged — none of them reference another
 * dictionary or entity.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after
 *   `copyDictionariesForConcat`/`copyDictionariesForSplit` has populated
 *   `temp.xfer_map_analysis_text_refs`.
 * @example
 * ```ts
 * await copyPageMeta(trx);
 * await copyAnalysisViolations(trx);
 * ```
 */
export async function copyAnalysisViolations(trx: Knex): Promise<void> {
	const columns = await listTransferColumns(trx, SRC, 'analysis_violations', [
		'id',
		'page_id',
		'message_text_id',
		'code_text_id',
	]);
	const passthrough = columns
		.map((col) => `s.${quoteTransferIdentifier(col)}`)
		.join(', ');

	await trx.raw(`
		INSERT INTO main.analysis_violations
			(page_id, message_text_id, code_text_id, ${columns.map(quoteTransferIdentifier).join(', ')})
		SELECT p.dest_id, mm.dest_id, mc.dest_id, ${passthrough}
		FROM ${SRC}.analysis_violations s
		JOIN xfer_ci_plan p ON p.src_id = s.page_id
			AND p.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.replace})
		JOIN xfer_map_analysis_text_refs mm ON mm.src_id = s.message_text_id
		LEFT JOIN xfer_map_analysis_text_refs mc ON mc.src_id = s.code_text_id
	`);
}
