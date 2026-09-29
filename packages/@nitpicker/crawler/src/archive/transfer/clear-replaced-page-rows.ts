import type { Knex } from 'knex';

import { SIMPLE_PAGE_SCOPED_TABLES } from './simple-page-scoped-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

/**
 * The page-scoped tables NOT covered by {@link SIMPLE_PAGE_SCOPED_TABLES}
 * (which this file also clears — see below) — each of these has its own
 * dedicated FK-remapping copy function (`copy-page-meta.ts`,
 * `copy-anchor-edges.ts`, `copy-image-items.ts`,
 * `copy-resource-ref-edges.ts`, `copy-page-html-blobs.ts`'s
 * `page_html_ref` write, `copy-page-console-logs.ts`,
 * `copy-analysis-violations.ts`), so they are listed explicitly rather
 * than folded into the shared "plain passthrough" table. Together the two
 * lists are a superset of `clearPageDerivedRows`' 17 tables (reused by
 * `resetFailedPages`/`repromoteExternalPages` for the same
 * un-scrape-then-re-insert shape) — this combined 21 additionally covers
 * `page_console_logs`/`page_templates`/`analysis_violations`/`page_errors`,
 * which that shared helper deliberately omits (see its own JSDoc for why:
 * `repromoteExternalPages` never needed them cleared, and folding them in
 * would have silently changed its existing behaviour). Concat's replace
 * path needs all 21 — a `replace` is a full Scoped-Replace of every
 * page-scoped table, not a partial one.
 */
const REMAPPED_PAGE_ROW_TABLES: readonly { table: string; pageColumn: string }[] = [
	{ table: 'page_meta', pageColumn: 'page_id' },
	{ table: 'anchor_edges', pageColumn: 'page_id' },
	{ table: 'image_items', pageColumn: 'page_id' },
	{ table: 'resource_ref_edges', pageColumn: 'page_id' },
	{ table: 'page_html_ref', pageColumn: 'page_id' },
	{ table: 'page_console_logs', pageColumn: 'pageId' },
	{ table: 'analysis_violations', pageColumn: 'page_id' },
];

/**
 * Deletes every page-scoped derived row for a concat source's `replace`-
 * action destination ids (`temp.xfer_ci_plan.dest_id`), across all 21
 * tables in {@link REMAPPED_PAGE_ROW_TABLES} + {@link SIMPLE_PAGE_SCOPED_TABLES}
 * combined — set-based (`WHERE ... IN (subquery)`), so there is no
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
	for (const { table, pageColumn } of tables) {
		await trx.raw(`
			DELETE FROM main.${table}
			WHERE ${pageColumn} IN (
				SELECT dest_id FROM xfer_ci_plan WHERE action = ${TRANSFER_ACTION.replace}
			)
		`);
	}
}
