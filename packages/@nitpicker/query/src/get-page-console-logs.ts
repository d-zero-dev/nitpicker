import type { PageConsoleLogEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { decodeJsonRef } from '@nitpicker/crawler';

import { hasConsoleLogsTables } from './has-console-logs-tables.js';

/**
 * Retrieves every console message / page error captured for the page at the
 * given URL, in capture order (issue #228).
 *
 * A direct live query (no read-model, no alias/redirect resolution) —
 * matching `getPageJsonLd`'s simpler pattern rather than `getPageDetail`'s
 * `resolveAliasAndRedirectChain`, since console logs are keyed to the exact
 * URL `replaceConsoleLogs` resolved at write time.
 *
 * Tolerates archives that predate the tables (see `listConsoleLogs`),
 * returning `[]` instead of throwing.
 * @param accessor - The archive accessor to query.
 * @param url - The page URL.
 * @returns Entries ordered by `ts` ascending, or `[]` when the page has no
 *   console log rows (including when the tables themselves are absent).
 * @example
 * const entries = await getPageConsoleLogs(accessor, 'https://example.com/');
 * for (const entry of entries) {
 *   console.log(`${entry.type}: ${entry.text}`);
 * }
 */
export async function getPageConsoleLogs(
	accessor: ArchiveAccessor,
	url: string,
): Promise<PageConsoleLogEntry[]> {
	const knex = accessor.getKnex();
	if (!(await hasConsoleLogsTables(knex))) {
		return [];
	}

	const rows = await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.join('page_console_logs as pcl', 'pcl.pageId', 'ci.id')
		.join('console_log_items as cli', 'cli.id', 'pcl.consoleLogId')
		// LEFT JOIN, not JOIN: `cli.text_id` is `null` for a call whose
		// text was the empty string (e.g. `console.log()` with no
		// arguments) — `text_refs` never stores `''`.
		.leftJoin('text_refs as tr', 'tr.id', 'cli.text_id')
		.leftJoin('url_refs as loc_ur', 'loc_ur.id', 'cli.loc_url_id')
		.leftJoin('text_refs as stack_tr', 'stack_tr.id', 'cli.stack_text_id')
		.leftJoin('json_refs as jr', 'jr.id', 'cli.args_json_id')
		.where('ur.url', url)
		.orderBy('pcl.ts', 'asc')
		.select(
			'cli.type as type',
			'tr.text as text',
			'jr.json_text as argsBody',
			'jr.codec as argsCodec',
			'loc_ur.url as locationUrl',
			'cli.loc_line as locationLine',
			'cli.loc_column as locationColumn',
			'stack_tr.text as stack',
			'pcl.ts as ts',
		);

	return rows.map((row) => {
		const argsJson = decodeJsonRef(
			row.argsBody as Buffer | string | null,
			row.argsCodec as 'zstd' | 'none' | null,
		);
		let args: unknown[] | null = null;
		if (argsJson !== null) {
			try {
				args = JSON.parse(argsJson) as unknown[];
			} catch {
				args = null;
			}
		}
		return {
			type: row.type as string,
			text: (row.text as string | null) ?? '',
			args,
			locationUrl: (row.locationUrl as string | null) ?? null,
			locationLine: (row.locationLine as number | null) ?? null,
			locationColumn: (row.locationColumn as number | null) ?? null,
			stack: (row.stack as string | null) ?? null,
			ts: Number(row.ts),
		};
	});
}
