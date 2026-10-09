import type { Knex } from 'knex';

import { listTransferColumns } from './list-transfer-columns.js';
import { quoteTransferIdentifier } from './quote-transfer-identifier.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const SRC = TRANSFER_SOURCE_ALIAS;

/**
 * Copies the four append-only journal tables with fresh (auto-assigned)
 * ids: `list_reconcile_runs`, `network_outages`, `dedupe_cap_events`
 * (none has an FK, so a plain `INSERT ... SELECT` of every non-`id`
 * column suffices — no id remapping needed for these three), and
 * `crawl_errors` (also no FK, but split additionally drops a row whose
 * `url` is no longer present in the output's `url_refs`, so a dropped
 * page's crawl-time errors do not linger in an archive that no longer
 * contains it — concat keeps every `crawl_errors` row unconditionally,
 * since nothing was dropped).
 *
 * `content_items.dedupe_cap_event_id` is deliberately NOT remapped here
 * to point at the copied `dedupe_cap_events` rows — it is always written
 * `NULL` by `insert-content-items.ts`/`replace-content-items.ts` and the
 * mandatory viewer read-model rebuild's `backfillDedupeCapEventId` fully
 * recomputes it afterwards by matching `content_items` rows against
 * `dedupe_cap_events.shape_key` from scratch, so writing a remapped id
 * here would only be immediately overwritten.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}.
 * @param mode - `'split'` filters `crawl_errors` to rows whose `url` (if
 *   any) survives in the destination's `url_refs`; `'concat'` copies every
 *   row unconditionally.
 * @example
 * ```ts
 * await copyJournalTables(trx, 'split');
 * ```
 */
export async function copyJournalTables(
	trx: Knex,
	mode: 'concat' | 'split',
): Promise<void> {
	for (const table of ['list_reconcile_runs', 'network_outages', 'dedupe_cap_events']) {
		const columns = await listTransferColumns(trx, SRC, table, ['id']);
		const quoted = columns.map(quoteTransferIdentifier);
		const columnList = quoted.map((col) => `s.${col}`).join(', ');
		await trx.raw(`
			INSERT INTO main.${table} (${quoted.join(', ')})
			SELECT ${columnList} FROM ${SRC}.${table} s
		`);
	}

	const crawlErrorColumns = await listTransferColumns(trx, SRC, 'crawl_errors', ['id']);
	const quotedCrawlErrorColumns = crawlErrorColumns.map(quoteTransferIdentifier);
	const crawlErrorSelectList = quotedCrawlErrorColumns
		.map((col) => `s.${col}`)
		.join(', ');
	const urlSurvivesFilter =
		mode === 'split'
			? `WHERE s.url IS NULL OR EXISTS (SELECT 1 FROM main.url_refs u WHERE u.url = s.url)`
			: '';
	await trx.raw(`
		INSERT INTO main.crawl_errors (${quotedCrawlErrorColumns.join(', ')})
		SELECT ${crawlErrorSelectList} FROM ${SRC}.crawl_errors s
		${urlSurvivesFilter}
	`);
}
