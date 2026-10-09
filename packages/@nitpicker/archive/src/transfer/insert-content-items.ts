import type { Knex } from 'knex';

import { listTransferColumns } from './list-transfer-columns.js';
import { quoteTransferIdentifier } from './quote-transfer-identifier.js';
import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const SRC = TRANSFER_SOURCE_ALIAS;

/**
 * Builds the per-column SELECT expression for one `content_items` column,
 * given its plan-driven remap rule.
 * @param column - The destination column name.
 * @param crawlOrderOffset - See {@link insertContentItems}.
 */
function columnExpression(column: string, crawlOrderOffset: number): string {
	switch (column) {
		case 'url_id': {
			return 'mu.dest_id';
		}
		case 'content_type_id': {
			return 'mct.dest_id';
		}
		case 'header_set_id': {
			return 'mhs.dest_id';
		}
		case 'redirect_dest_id':
		case 'alias_of_id':
		case 'dedupe_cap_event_id': {
			// Never carried over verbatim: `redirect_dest_id` is remapped in a
			// later pass once every source id has a destination id
			// (`remap-redirect-dest-ids.ts`); `alias_of_id`/`dedupe_cap_event_id`
			// are always recomputed from scratch by the mandatory viewer
			// read-model rebuild's backfills, so writing a stale source value
			// here would only be overwritten moments later.
			return 'NULL';
		}
		case 'is_external': {
			// A `stub` row is forced external regardless of what it was in the
			// source archive (it may well have been a fully-scraped internal
			// page there) — that IS the definition of "kept as a stub".
			return `CASE WHEN p.action = ${TRANSFER_ACTION.stub} THEN 1 ELSE s.is_external END`;
		}
		case 'is_target': {
			return `CASE WHEN p.action = ${TRANSFER_ACTION.stub} THEN 0 ELSE s.is_target END`;
		}
		case 'crawl_order': {
			// `s.crawl_order + offset` is NULL-safe for free: SQLite's `+`
			// against a NULL operand yields NULL, matching a source row whose
			// `crawl_order` was never set (pre-#... archives, or rows written
			// outside the normal crawl-order-assigning path).
			return `s.crawl_order + ${crawlOrderOffset}`;
		}
		default: {
			return `s.${quoteTransferIdentifier(column)}`;
		}
	}
}

/**
 * Inserts every `full`/`stub`-action `content_items` row from
 * `temp.xfer_ci_plan` into the destination, then backfills each plan row's
 * `dest_id` with the id the insert assigned.
 *
 * Every column is looked up via {@link listTransferColumns} (never a
 * hand-written list — see that function's docs for why) and given an
 * explicit SELECT expression by {@link columnExpression}: dictionary FK
 * columns resolve through their `temp.xfer_map_*` table, `is_external`/
 * `is_target` are forced for `stub` rows, and `redirect_dest_id`/
 * `alias_of_id`/`dedupe_cap_event_id` are always written `NULL` (see
 * {@link columnExpression}'s docs). Every other column passes through
 * unchanged.
 *
 * Must run AFTER every dictionary copy this source needs
 * (`copy-dictionaries-for-concat.ts` / `copy-dictionaries-for-split.ts`,
 * `copy-header-set-children.ts`) — a `full`/`stub` row's `url_id` is NOT
 * NULL, so a missing `temp.xfer_map_url_refs` entry surfaces immediately
 * as a constraint violation rather than silently inserting garbage.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}.
 * @param options - Options.
 * @param options.crawlOrderOffset - Added to every copied row's
 *   `crawl_order` (concat: the destination's current `MAX(crawl_order)`,
 *   so a second source's pages sort after the first's; split: `0`, since
 *   a single source's relative order is preserved as-is).
 * @example
 * ```ts
 * await insertContentItems(trx, { crawlOrderOffset: 0 });
 * ```
 */
export async function insertContentItems(
	trx: Knex,
	options: { crawlOrderOffset: number },
): Promise<void> {
	const columns = await listTransferColumns(trx, SRC, 'content_items', ['id']);
	const columnList = columns.map(quoteTransferIdentifier).join(', ');
	const selectList = columns
		.map((col) => columnExpression(col, options.crawlOrderOffset))
		.join(', ');

	await trx.raw(`
		INSERT INTO main.content_items (${columnList})
		SELECT ${selectList}
		FROM ${SRC}.content_items s
		JOIN xfer_ci_plan p ON p.src_id = s.id
		LEFT JOIN xfer_map_url_refs mu ON mu.src_id = s.url_id
		LEFT JOIN xfer_map_content_type_refs mct ON mct.src_id = s.content_type_id
		LEFT JOIN xfer_map_header_sets mhs ON mhs.src_id = s.header_set_id
		WHERE p.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.stub})
		ORDER BY s.id
	`);

	await trx.raw(`
		UPDATE xfer_ci_plan
		SET dest_id = x.dest_id
		FROM (
			SELECT p.src_id AS src_id, d.id AS dest_id
			FROM xfer_ci_plan p
			JOIN ${SRC}.content_items s ON s.id = p.src_id
			JOIN xfer_map_url_refs mu ON mu.src_id = s.url_id
			JOIN main.content_items d ON d.url_id = mu.dest_id
			WHERE p.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.stub})
		) x
		WHERE xfer_ci_plan.src_id = x.src_id
	`);
}
