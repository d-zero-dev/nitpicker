import type { ArchiveAccessor } from '@nitpicker/crawler';

import { readErrorLog } from './read-error-log.js';

/** chunk size for `WHERE … IN (?)` SQLite parameter packing. */
const CHUNK_SIZE = 500;

/**
 * One resolved failure message, with the timestamp it was recorded at (when
 * known). `createdAt` is what lets `getSummary` decide whether the failure
 * falls inside a `network_outages` window — see `is-within-outage-window.ts`
 * in the crawler package. `null` only for `error.log`-sourced messages
 * (plain-text legacy fallback, no timestamp field), which can therefore
 * never be attributed to an outage.
 */
export interface ResolvedFailedPageMessage {
	message: string;
	createdAt: number | null;
}

/**
 * Resolve a raw error message (plus its timestamp) for each `pages.id` that
 * has `status = -1`.
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
 * @returns `Map<pageId, ResolvedFailedPageMessage>` — only ids with a
 *   resolved message are present.
 */
export async function resolveFailedPageMessages(
	accessor: ArchiveAccessor,
	pageIds: readonly number[],
): Promise<Map<number, ResolvedFailedPageMessage>> {
	if (pageIds.length === 0) {
		return new Map();
	}
	const knex = accessor.getKnex();

	const idToUrl = new Map<number, string>();
	for (let i = 0; i < pageIds.length; i += CHUNK_SIZE) {
		const chunk = pageIds.slice(i, i + CHUNK_SIZE);
		const rows = (await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id', 'ur.url as url')
			.whereIn('ci.id', chunk)) as {
			id: number;
			url: string;
		}[];
		for (const row of rows) {
			idToUrl.set(row.id, row.url);
		}
	}

	// Source 1: page_errors — `pageId` keyed. Earliest insert wins per pageId
	// because schema permits multiple rows per page (the first row is
	// usually the trigger cause; later rows are follow-on noise).
	const pageErrorByPageId = new Map<number, ResolvedFailedPageMessage>();
	if (await knex.schema.hasTable('page_errors')) {
		for (let i = 0; i < pageIds.length; i += CHUNK_SIZE) {
			const chunk = pageIds.slice(i, i + CHUNK_SIZE);
			const rows = (await knex('page_errors')
				.select('pageId', 'message', 'createdAt')
				.whereIn('pageId', chunk)
				.orderBy('id', 'asc')) as {
				pageId: number;
				message: string;
				createdAt: number;
			}[];
			for (const row of rows) {
				if (!pageErrorByPageId.has(row.pageId)) {
					pageErrorByPageId.set(row.pageId, {
						message: row.message,
						createdAt: row.createdAt,
					});
				}
			}
		}
	}

	// Source 2: crawl_errors — URL keyed. Latest `createdAt` wins: the most
	// recent message is the most relevant for both classification and
	// outage attribution.
	const crawlErrorByUrl = new Map<string, ResolvedFailedPageMessage>();
	if (await knex.schema.hasTable('crawl_errors')) {
		const urls = [...idToUrl.values()];
		for (let i = 0; i < urls.length; i += CHUNK_SIZE) {
			const chunk = urls.slice(i, i + CHUNK_SIZE);
			const rows = (await knex('crawl_errors')
				.select('url', 'message', 'createdAt')
				.whereIn('url', chunk)) as {
				url: string | null;
				message: string;
				createdAt: number;
			}[];
			for (const row of rows) {
				if (row.url === null) {
					continue;
				}
				const existing = crawlErrorByUrl.get(row.url);
				if (existing === undefined || row.createdAt > (existing.createdAt ?? -Infinity)) {
					crawlErrorByUrl.set(row.url, {
						message: row.message,
						createdAt: row.createdAt,
					});
				}
			}
		}
	}

	// Source 3: error.log — single pass. No timestamp field, so `createdAt`
	// is always `null` for these — they can never be attributed to an
	// outage window.
	const logByUrl = new Map<string, ResolvedFailedPageMessage>();
	const logRecords = await readErrorLog(accessor.tmpDir);
	for (const record of logRecords) {
		if (record.url !== null && !logByUrl.has(record.url)) {
			logByUrl.set(record.url, { message: record.message, createdAt: null });
		}
	}

	const resolved = new Map<number, ResolvedFailedPageMessage>();
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
