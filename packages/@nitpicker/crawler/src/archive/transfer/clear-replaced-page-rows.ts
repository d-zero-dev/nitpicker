import type { Knex } from 'knex';

import { SIMPLE_PAGE_SCOPED_TABLES } from './simple-page-scoped-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

/**
 * The page-scoped tables NOT covered by {@link SIMPLE_PAGE_SCOPED_TABLES}
 * (which this file also clears — see below) — each of these has its own
 * dedicated FK-remapping copy function (`copy-page-meta.ts`,
 * `copy-anchor-edges.ts`, `copy-image-items.ts`,
 * `copy-resource-ref-edges.ts`, `copy-page-console-logs.ts`), so they are
 * listed explicitly rather than folded into the shared "plain passthrough"
 * table. Together the two lists are a superset of `clearPageDerivedRows`'
 * tables (reused by `resetFailedPages`/`repromoteExternalPages` for the same
 * un-scrape-then-re-insert shape) — the combined set additionally covers
 * `page_console_logs`/`page_templates`/`page_errors`, which that shared
 * helper deliberately omits (see its own JSDoc for why:
 * `repromoteExternalPages` never needed them cleared, and folding them in
 * would have silently changed its existing behaviour). Concat's replace
 * path needs all of them — a `replace` is a full Scoped-Replace of every
 * page-scoped table, not a partial one.
 */
const REMAPPED_PAGE_ROW_TABLES: readonly { table: string; pageColumn: string }[] = [
	{ table: 'page_meta', pageColumn: 'page_id' },
	{ table: 'anchor_edges', pageColumn: 'page_id' },
	{ table: 'image_items', pageColumn: 'page_id' },
	{ table: 'resource_ref_edges', pageColumn: 'page_id' },
	{ table: 'page_console_logs', pageColumn: 'pageId' },
];

/**
 * Deletes every page-scoped derived row for a concat source's `replace`-
 * action destination ids (`temp.xfer_ci_plan.dest_id`), across every
 * table in {@link REMAPPED_PAGE_ROW_TABLES} + {@link SIMPLE_PAGE_SCOPED_TABLES}
 * combined. The legacy `analysis_violations` rows are also deleted when the
 * destination archive still carries that table (guarded by `hasTable`),
 * because its legacy FK to `content_items` would otherwise block the
 * deletion. Set-based (`WHERE ... IN (subquery)`), so there is no
 * `SQLITE_LIMIT_VARIABLE_NUMBER` bind-count concern regardless of how many
 * rows are being replaced.
 *
 * Must run BEFORE the page-scoped table copies
 * (`copy-page-meta.ts` et al.) so their `INSERT`s never collide with
 * stale rows left over from the losing destination row's own prior data.
 * @param trx - Transaction with the source ATTACHed.
 * @example
 * ```ts
 * await clearReplacedPageRows(trx);
 * await replaceContentItems(trx, { crawlOrderOffset: 0 });
 * ```
 */
export async function clearReplacedPageRows(trx: Knex): Promise<void> {
	const tables = [...REMAPPED_PAGE_ROW_TABLES, ...SIMPLE_PAGE_SCOPED_TABLES];
	if (await trx.schema.hasTable('analysis_violations')) {
		tables.push({ table: 'analysis_violations', pageColumn: 'page_id' });
	}
	for (const { table, pageColumn } of tables) {
		await trx.raw(`
			DELETE FROM main.${table}
			WHERE ${pageColumn} IN (
				SELECT dest_id FROM xfer_ci_plan WHERE action = ${TRANSFER_ACTION.replace}
			)
		`);
	}
}
