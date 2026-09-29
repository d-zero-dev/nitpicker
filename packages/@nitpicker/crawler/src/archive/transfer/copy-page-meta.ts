import type { Knex } from 'knex';

import { PAGE_META_COLUMN_MAPS } from '../page-meta-column-maps.js';

import { listTransferColumns } from './list-transfer-columns.js';
import { quoteTransferIdentifier } from './quote-transfer-identifier.js';
import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const SRC = TRANSFER_SOURCE_ALIAS;
const URL_COLUMNS = new Set(PAGE_META_COLUMN_MAPS.url.map((m) => m.target));
const TEXT_COLUMNS = new Set(PAGE_META_COLUMN_MAPS.text.map((m) => m.target));

/**
 * Copies `page_meta` for every `full`/`replace`-action page (never
 * `stub` — a stub carries no page-scoped data at all, per
 * `transfer-action.ts`'s docs; never `skip`, whose destination row's
 * existing `page_meta` is untouched).
 *
 * `page_meta` has TEN `url_id`-shaped columns and EIGHT `text_id`-shaped
 * columns ({@link PAGE_META_COLUMN_MAPS}), each potentially pointing at a
 * DIFFERENT dictionary row — unlike `content_items`' single `url_id`, one
 * shared join alias cannot serve every column. Each FK column gets its own
 * uniquely-aliased `LEFT JOIN` against the relevant `temp.xfer_map_*`
 * table, built dynamically from {@link listTransferColumns} so a future
 * `page_meta` column addition is picked up without touching this file
 * (only `page-meta-column-maps.ts` needs updating for a new url/text
 * column; a new plain column needs nothing here at all).
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after every dictionary copy
 *   AND after `insert-content-items.ts`/`replace-content-items.ts` have
 *   resolved every kept page's `dest_id`.
 * @example
 * ```ts
 * await insertContentItems(trx, { crawlOrderOffset: 0 });
 * await copyPageMeta(trx);
 * ```
 */
export async function copyPageMeta(trx: Knex): Promise<void> {
	const columns = await listTransferColumns(trx, SRC, 'page_meta', ['page_id']);
	const joins: string[] = [];
	const exprFor = (column: string): string => {
		const quotedColumn = quoteTransferIdentifier(column);
		if (URL_COLUMNS.has(column)) {
			const alias = `mu_${column}`;
			joins.push(
				`LEFT JOIN xfer_map_url_refs ${alias} ON ${alias}.src_id = pm.${quotedColumn}`,
			);
			return `${alias}.dest_id`;
		}
		if (TEXT_COLUMNS.has(column)) {
			const alias = `mt_${column}`;
			joins.push(
				`LEFT JOIN xfer_map_text_refs ${alias} ON ${alias}.src_id = pm.${quotedColumn}`,
			);
			return `${alias}.dest_id`;
		}
		if (column === 'meta_extras_json_id') {
			joins.push('LEFT JOIN xfer_map_json_refs mj ON mj.src_id = pm.meta_extras_json_id');
			return 'mj.dest_id';
		}
		return `pm.${quotedColumn}`;
	};

	const selectList = columns.map(exprFor).join(', ');
	const joinList = joins.join('\n');
	const quotedColumnList = columns.map(quoteTransferIdentifier).join(', ');

	await trx.raw(`
		INSERT INTO main.page_meta (page_id, ${quotedColumnList})
		SELECT p.dest_id, ${selectList}
		FROM ${SRC}.page_meta pm
		JOIN xfer_ci_plan p ON p.src_id = pm.page_id
			AND p.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.replace})
		${joinList}
		WHERE true
		ON CONFLICT(page_id) DO NOTHING
	`);
}
