import type { ConsoleLogSummaryEntry, ListConsoleLogsOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { hasConsoleLogsTables } from './has-console-logs-tables.js';
import { resolveListLimit } from './resolve-list-limit.js';
import { resolveListOffset } from './resolve-list-offset.js';
import { resolveListSortBy } from './resolve-list-sort-by.js';
import { resolveListSortOrder } from './resolve-list-sort-order.js';

/** Default page size when `options.limit` is absent or invalid. */
const DEFAULT_LIMIT = 100;

/** Sort fields accepted by {@link listConsoleLogs}. */
const SORT_BY_VALUES = ['totalCount', 'pageCount', 'text', 'type'] as const;

/**
 * Lists distinct console messages / page errors, aggregated across every
 * page they occurred on (issue #228).
 *
 * A live `GROUP BY` aggregation over `console_log_items` +
 * `page_console_logs`, following the simpler pattern `getViolations` uses
 * (no dedicated read-model table / fast-path dispatch): unlike
 * `viewer_header_checks` / `viewer_duplicates`, there is no pre-#228
 * legacy data this needs to fall back to, so a read-model layer would add
 * `VIEWER_READ_MODEL_SCHEMA_VERSION` churn without an existing-data
 * problem to solve. Revisit if `EXPLAIN QUERY PLAN` on a large archive
 * shows this aggregation is too slow for the viewer's request budget
 * (evidence-before-indexing).
 *
 * Tolerates archives that predate the tables — a read-only `stub`
 * connection or an archive that has never been re-opened by a writer
 * since this feature shipped — by returning an empty page instead of
 * throwing "no such table" (same convention as `listNetworkOutages`).
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options.
 * @returns The matching entries for the requested page plus the total
 *   matching count (before pagination).
 * @example
 * const { items, total } = await listConsoleLogs(accessor, { type: 'error', limit: 50 });
 * console.log(`${total} distinct errors`, items[0]?.text);
 */
export async function listConsoleLogs(
	accessor: ArchiveAccessor,
	options: ListConsoleLogsOptions = {},
): Promise<{ items: ConsoleLogSummaryEntry[]; total: number }> {
	const knex = accessor.getKnex();
	if (!(await hasConsoleLogsTables(knex))) {
		return { items: [], total: 0 };
	}

	const limit = resolveListLimit(options.limit, DEFAULT_LIMIT);
	const offset = resolveListOffset(options.offset);
	const sortBy = resolveListSortBy(options.sortBy, SORT_BY_VALUES, 'totalCount');
	const sortOrder = resolveListSortOrder(options.sortOrder, 'desc');

	const grouped = knex('console_log_items as cli')
		.join('page_console_logs as pcl', 'pcl.consoleLogId', 'cli.id')
		// LEFT JOIN, not JOIN: `cli.text_id` is `null` for a call whose
		// text was the empty string (e.g. `console.log()` with no
		// arguments) — `text_refs` never stores `''`.
		.leftJoin('text_refs as tr', 'tr.id', 'cli.text_id')
		.leftJoin('url_refs as ur', 'ur.id', 'cli.loc_url_id')
		.groupBy('cli.id');
	if (options.type) {
		grouped.where('cli.type', options.type);
	}

	const totalRow = await knex
		.count<{ count: string }[]>({ count: '*' })
		.from(grouped.clone().select('cli.id').as('matched'))
		.first();
	const total = Number(totalRow?.count ?? 0);

	// `COALESCE(tr.text, '')`, not bare `tr.text`: the LEFT JOIN yields
	// `NULL` for a row whose `text_id` is `null` (the empty-text case),
	// and NULLs sort first/last inconsistently across engines — matching
	// this to the displayed `''` value keeps sort and display consistent.
	const orderColumn = (
		{
			totalCount: 'totalCount',
			pageCount: 'pageCount',
			text: "COALESCE(tr.text, '')",
			type: 'cli.type',
		} as const
	)[sortBy];

	const rows = await grouped
		.clone()
		.select(
			'cli.id as consoleLogId',
			'cli.type as type',
			'tr.text as text',
			'ur.url as locationUrl',
			'cli.loc_line as locationLine',
			knex.raw('COUNT(DISTINCT pcl."pageId") as pageCount'),
			knex.raw('COUNT(*) as totalCount'),
		)
		.orderByRaw(`${orderColumn} ${sortOrder}, cli.id ${sortOrder}`)
		.limit(limit)
		.offset(offset);

	const items: ConsoleLogSummaryEntry[] = rows.map((row) => ({
		consoleLogId: row.consoleLogId as number,
		type: row.type as string,
		text: (row.text as string | null) ?? '',
		locationUrl: (row.locationUrl as string | null) ?? null,
		locationLine: (row.locationLine as number | null) ?? null,
		pageCount: Number(row.pageCount),
		totalCount: Number(row.totalCount),
	}));

	return { items, total };
}
