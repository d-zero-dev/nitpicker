import type { ArchiveAccessor } from '@nitpicker/crawler';

import { readErrorLog } from './read-error-log.js';

/** chunk size for `WHERE … IN (?)` SQLite parameter packing. */
const CHUNK_SIZE = 500;

/**
 * Resolve a raw error message for each `pages.id` that has `status = -1`.
 *
 * Bulk-queried — at most `ceil(N / 500)` SQL round-trips for N page ids
 * (plus one `error.log` read), never N. Three message sources are consulted
 * in priority order:
 *
 * 1. **`page_errors`** — joined on `pageId`. The most direct signal (a scrape
 *    fired and recorded its own message).
 * 2. **`crawl_errors`** — joined on `url`. Used when the failure happened in
 *    the crawler's `error` channel before a page row was scraped.
 * 3. **`error.log`** — plain-text fallback for archives that predate the
 *    structured `crawl_errors` table.
 *
 * Page ids with no message in any source are simply absent from the returned
 * map; callers (see `getSummary`) treat the absence as `'unknown'`.
 *
 * Legacy-archive safety: missing tables / log file are tolerated. The map is
 * never partially populated on failure — every miss is silent rather than
 * thrown, mirroring `getErrorKinds`.
 * @param accessor - The opened archive accessor.
 * @param pageIds - `pages.id` values to look up (already filtered to status=-1).
 * @returns `Map<pageId, message>` — only ids with a resolved message are present.
 */
export async function resolveFailedPageMessages(
	accessor: ArchiveAccessor,
	pageIds: readonly number[],
): Promise<Map<number, string>> {
	if (pageIds.length === 0) {
		return new Map();
	}
	const knex = accessor.getKnex();

	const idToUrl = new Map<number, string>();
	for (let i = 0; i < pageIds.length; i += CHUNK_SIZE) {
		const chunk = pageIds.slice(i, i + CHUNK_SIZE);
		const rows = (await knex('pages').select('id', 'url').whereIn('id', chunk)) as {
			id: number;
			url: string;
		}[];
		for (const row of rows) {
			idToUrl.set(row.id, row.url);
		}
	}

	// Source 1: page_errors — `pageId` keyed. Earliest insert wins per pageId
	// because schema permits multiple rows per page.
	const pageErrorByPageId = new Map<number, string>();
	if (await knex.schema.hasTable('page_errors')) {
		for (let i = 0; i < pageIds.length; i += CHUNK_SIZE) {
			const chunk = pageIds.slice(i, i + CHUNK_SIZE);
			const rows = (await knex('page_errors')
				.select('pageId', 'message')
				.whereIn('pageId', chunk)) as {
				pageId: number;
				message: string;
			}[];
			for (const row of rows) {
				if (!pageErrorByPageId.has(row.pageId)) {
					pageErrorByPageId.set(row.pageId, row.message);
				}
			}
		}
	}

	// Source 2: crawl_errors — URL keyed. Same earliest-wins rule.
	const crawlErrorByUrl = new Map<string, string>();
	if (await knex.schema.hasTable('crawl_errors')) {
		const urls = [...idToUrl.values()];
		for (let i = 0; i < urls.length; i += CHUNK_SIZE) {
			const chunk = urls.slice(i, i + CHUNK_SIZE);
			const rows = (await knex('crawl_errors')
				.select('url', 'message')
				.whereIn('url', chunk)) as { url: string | null; message: string }[];
			for (const row of rows) {
				if (row.url !== null && !crawlErrorByUrl.has(row.url)) {
					crawlErrorByUrl.set(row.url, row.message);
				}
			}
		}
	}

	// Source 3: error.log — single pass.
	const logByUrl = new Map<string, string>();
	const logRecords = await readErrorLog(accessor.tmpDir);
	for (const record of logRecords) {
		if (record.url !== null && !logByUrl.has(record.url)) {
			logByUrl.set(record.url, record.message);
		}
	}

	const resolved = new Map<number, string>();
	for (const id of pageIds) {
		const pageErr = pageErrorByPageId.get(id);
		if (pageErr !== undefined) {
			resolved.set(id, pageErr);
			continue;
		}
		const url = idToUrl.get(id);
		if (url === undefined) {
			continue;
		}
		const crawlErr = crawlErrorByUrl.get(url);
		if (crawlErr !== undefined) {
			resolved.set(id, crawlErr);
			continue;
		}
		const logErr = logByUrl.get(url);
		if (logErr !== undefined) {
			resolved.set(id, logErr);
		}
	}
	return resolved;
}
