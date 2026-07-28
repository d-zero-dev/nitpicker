import type { Knex } from 'knex';

import { hasConsoleLogsTables } from './has-console-logs-tables.js';

/** The three console log types surfaced on the Summary dashboard badges. */
const BADGE_TYPES = ['pageerror', 'error', 'warn'] as const;

/**
 * Counts total `page_console_logs` occurrences (not distinct-message
 * counts) for the `pageerror` / `error` / `warn` types — the shared
 * aggregation behind both `getSummary`'s live computation and
 * `buildViewerReadModel`'s `viewer_summary.console_json` (issue #228).
 *
 * Tolerates an archive that predates the tables (same convention as
 * `listConsoleLogs` / `listNetworkOutages`), returning all-zero counts
 * instead of throwing.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns Occurrence counts keyed by type; `0` for a type with no rows.
 * @example
 * const counts = await countConsoleLogsByType(accessor.getKnex());
 * console.log(`${counts.error} error occurrences`);
 */
export async function countConsoleLogsByType(
	knex: Knex,
): Promise<{ pageerror: number; error: number; warn: number }> {
	const zero = { pageerror: 0, error: 0, warn: 0 };
	if (!(await hasConsoleLogsTables(knex))) {
		return zero;
	}

	const rows = (await knex('page_console_logs as pcl')
		.join('console_log_items as cli', 'cli.id', 'pcl.consoleLogId')
		.whereIn('cli.type', BADGE_TYPES)
		.groupBy('cli.type')
		.select('cli.type as type')
		.count('pcl.id as count')) as { type: string; count: number | string }[];

	for (const row of rows) {
		if (row.type === 'pageerror' || row.type === 'error' || row.type === 'warn') {
			zero[row.type] = Number(row.count);
		}
	}
	return zero;
}
