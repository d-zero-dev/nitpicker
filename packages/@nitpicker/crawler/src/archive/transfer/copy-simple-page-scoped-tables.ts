import type { Knex } from 'knex';

import { listTransferColumns } from './list-transfer-columns.js';
import { quoteTransferIdentifier } from './quote-transfer-identifier.js';
import { SIMPLE_PAGE_SCOPED_TABLES } from './simple-page-scoped-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const SRC = TRANSFER_SOURCE_ALIAS;

/**
 * Copies every table in {@link SIMPLE_PAGE_SCOPED_TABLES}, for every
 * `full`/`replace`-action page, using {@link listTransferColumns} for the
 * column list (never a hand-written one — see that function's docs) since
 * every column here passes straight through unchanged.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}.
 * @example
 * ```ts
 * await copyPageMeta(trx);
 * await copySimplePageScopedTables(trx);
 * ```
 */
export async function copySimplePageScopedTables(trx: Knex): Promise<void> {
	for (const { table, pageColumn } of SIMPLE_PAGE_SCOPED_TABLES) {
		const columns = await listTransferColumns(trx, SRC, table, ['id', pageColumn]);
		const quotedColumns = columns.map(quoteTransferIdentifier);
		const columnList = quotedColumns.map((col) => `s.${col}`).join(', ');
		const quotedPageColumn = quoteTransferIdentifier(pageColumn);
		await trx.raw(`
			INSERT INTO main.${table} (${quotedPageColumn}, ${quotedColumns.join(', ')})
			SELECT p.dest_id, ${columnList}
			FROM ${SRC}.${table} s
			JOIN xfer_ci_plan p ON p.src_id = s.${quotedPageColumn}
				AND p.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.replace})
		`);
	}
}
