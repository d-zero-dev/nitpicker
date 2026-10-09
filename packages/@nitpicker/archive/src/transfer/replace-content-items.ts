import type { Knex } from 'knex';

import { listTransferColumns } from './list-transfer-columns.js';
import { quoteTransferIdentifier } from './quote-transfer-identifier.js';
import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const SRC = TRANSFER_SOURCE_ALIAS;

/**
 * Overwrites every `replace`-action destination `content_items` row
 * (concat only — split never assigns `replace`) with this source's
 * column values, using the same per-column remap rules
 * {@link import('./insert-content-items.js').insertContentItems} applies
 * (dictionary FKs through their `temp.xfer_map_*` table, `redirect_dest_id`/
 * `alias_of_id`/`dedupe_cap_event_id` always `NULL`, `crawl_order` offset).
 *
 * `url_id` is deliberately excluded from the UPDATE — a `replace` row was
 * matched by URL string in the first place (`plan-content-items-for-concat.ts`),
 * so the destination's `url_id` already points at the correct `url_refs`
 * row and must not change. `is_external`/`is_target` are never forced
 * here (unlike `insertContentItems`'s `stub` case) — concat has no stub
 * action, so the source's own observed values pass straight through the
 * generic `default` branch.
 *
 * Must run BEFORE {@link import('./insert-content-items.js').insertContentItems}
 * would otherwise be fine in either order relative to it (they touch
 * disjoint plan actions), but MUST run before the page-scoped table
 * copies (`copy-page-meta.ts` et al.) — and after
 * {@link import('./clear-replaced-page-rows.js').clearReplacedPageRows}
 * has deleted the old derived rows for these same destination ids, so the
 * fresh page-scoped copy does not collide with stale data.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}.
 * @param options - Options.
 * @param options.crawlOrderOffset - See `insertContentItems`'s parameter
 *   of the same name — the same value passed to that call for this source.
 * @example
 * ```ts
 * await clearReplacedPageRows(trx);
 * await replaceContentItems(trx, { crawlOrderOffset: 0 });
 * await insertContentItems(trx, { crawlOrderOffset: 0 });
 * ```
 */
export async function replaceContentItems(
	trx: Knex,
	options: { crawlOrderOffset: number },
): Promise<void> {
	const columns = await listTransferColumns(trx, SRC, 'content_items', ['id', 'url_id']);
	const setList = columns
		.map((col) => `${quoteTransferIdentifier(col)} = x.${quoteTransferIdentifier(col)}`)
		.join(', ');
	const selectList = columns
		.map((col) => {
			const quotedCol = quoteTransferIdentifier(col);
			switch (col) {
				case 'content_type_id': {
					return `mct.dest_id AS ${quotedCol}`;
				}
				case 'header_set_id': {
					return `mhs.dest_id AS ${quotedCol}`;
				}
				case 'redirect_dest_id':
				case 'alias_of_id':
				case 'dedupe_cap_event_id': {
					return `NULL AS ${quotedCol}`;
				}
				case 'crawl_order': {
					return `s.crawl_order + ${options.crawlOrderOffset} AS ${quotedCol}`;
				}
				default: {
					return `s.${quotedCol} AS ${quotedCol}`;
				}
			}
		})
		.join(', ');

	await trx.raw(`
		UPDATE main.content_items
		SET ${setList}
		FROM (
			SELECT p.dest_id AS dest_id, ${selectList}
			FROM xfer_ci_plan p
			JOIN ${SRC}.content_items s ON s.id = p.src_id
			LEFT JOIN xfer_map_content_type_refs mct ON mct.src_id = s.content_type_id
			LEFT JOIN xfer_map_header_sets mhs ON mhs.src_id = s.header_set_id
			WHERE p.action = ${TRANSFER_ACTION.replace}
		) x
		WHERE main.content_items.id = x.dest_id
	`);
}
