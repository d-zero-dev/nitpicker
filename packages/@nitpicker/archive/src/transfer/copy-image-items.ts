import type { Knex } from 'knex';

import { listTransferColumns } from './list-transfer-columns.js';
import { quoteTransferIdentifier } from './quote-transfer-identifier.js';
import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const SRC = TRANSFER_SOURCE_ALIAS;
/** `image_items` columns that resolve through `temp.xfer_map_url_refs`. */
const URL_COLUMNS = new Set(['src_url_id', 'current_src_url_id']);
/** `image_items` columns that resolve through `temp.xfer_map_blob_refs`. */
const BLOB_COLUMNS = new Set(['src_blob_id', 'current_src_blob_id']);

/**
 * Copies `image_items` for every `full`/`replace`-action page (never
 * `stub`/`skip` — see `copy-page-meta.ts`'s docs for the same rule).
 *
 * Like `page_meta`, several columns are FK-shaped but each points at its
 * own distinct dictionary row, so each gets a uniquely-aliased join
 * rather than one shared alias. `dom_path_text_id` is `NOT NULL` in the
 * schema (every image resolves to a DOM-position label, falling back to
 * a synthetic `img[unknown]` text at write time — see
 * `create-entity-tables.ts`), so an unmapped id here would surface
 * immediately as a constraint violation rather than silently going missing.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}.
 * @example
 * ```ts
 * await copyPageMeta(trx);
 * await copyImageItems(trx);
 * ```
 */
export async function copyImageItems(trx: Knex): Promise<void> {
	const columns = await listTransferColumns(trx, SRC, 'image_items', ['id', 'page_id']);
	const joins: string[] = [];
	const exprFor = (column: string): string => {
		const quotedColumn = quoteTransferIdentifier(column);
		if (column === 'alt_text_id' || column === 'dom_path_text_id') {
			const alias = `mt_${column}`;
			joins.push(
				`LEFT JOIN xfer_map_text_refs ${alias} ON ${alias}.src_id = ii.${quotedColumn}`,
			);
			return `${alias}.dest_id`;
		}
		if (URL_COLUMNS.has(column)) {
			const alias = `mu_${column}`;
			joins.push(
				`LEFT JOIN xfer_map_url_refs ${alias} ON ${alias}.src_id = ii.${quotedColumn}`,
			);
			return `${alias}.dest_id`;
		}
		if (BLOB_COLUMNS.has(column)) {
			const alias = `mb_${column}`;
			joins.push(
				`LEFT JOIN xfer_map_blob_refs ${alias} ON ${alias}.src_id = ii.${quotedColumn}`,
			);
			return `${alias}.dest_id`;
		}
		return `ii.${quotedColumn}`;
	};

	const selectList = columns.map(exprFor).join(', ');
	const joinList = joins.join('\n');
	const quotedColumnList = columns.map(quoteTransferIdentifier).join(', ');

	await trx.raw(`
		INSERT INTO main.image_items (page_id, ${quotedColumnList})
		SELECT p.dest_id, ${selectList}
		FROM ${SRC}.image_items ii
		JOIN xfer_ci_plan p ON p.src_id = ii.page_id
			AND p.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.replace})
		${joinList}
	`);
}
