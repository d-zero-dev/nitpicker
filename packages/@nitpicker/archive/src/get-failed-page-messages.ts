import type { Knex } from 'knex';

/** chunk size for `WHERE … IN (?)` SQLite parameter packing. */
const CHUNK_SIZE = 500;

/**
 * One resolved failure message, with the timestamp it was recorded at.
 * `createdAt` is what lets a caller (`resetFailedPages`) decide whether the
 * failure falls inside a `network_outages` window and should be treated as
 * retryable regardless of its classified `ErrorKind` — see
 * `is-within-outage-window.ts`.
 */
export interface FailedPageMessage {
	message: string;
	/** Epoch ms the message was recorded (`page_errors.createdAt` or `crawl_errors.createdAt`). */
	createdAt: number;
}

/**
 * Bulk-resolve a raw error message (plus its timestamp) for each given page
 * id, using only sources reachable from a {@link Knex} handle. Read order:
 * `page_errors` (keyed by `pageId`, the most direct signal a scrape attempt
 * recorded), then `crawl_errors` (keyed by `url`, the crawler-channel
 * record for failures that happened before a page row was scraped).
 *
 * **Known limitation — pre-`crawl_errors` archives**: This helper does NOT
 * read `error.log`. The `crawl_errors` table is created empty (by
 * `initSchema` on fresh archives, by `scripts/migrate-to-0.13.mjs` on
 * migrated ones) and historical lines from `error.log` are never
 * back-filled, so an archive whose failures live only in `error.log`
 * will resolve every id to "no message" here. The
 * downstream `Database.resetFailedPages` treats absence as `unknown` (still
 * retryable), so legacy archives lose the permanent-kind exclusion until a
 * fresh crawl run populates `crawl_errors` / `page_errors`. The trade-off
 * (no error.log parsing in the writer path) keeps the writer dependency
 * surface narrow and avoids re-implementing the parser already living in
 * `@nitpicker/query`'s `resolveFailedPageMessages` — which the crawler
 * package cannot import (reverse-direction dependency). When this matters
 * in practice, run the archive through one fresh `crawl --retry-failed`
 * pass first to populate the structured tables.
 *
 * Pages with no message in any consulted source are simply absent from the
 * returned map; callers treat the absence as "unclassifiable, keep retrying"
 * (i.e. `unknown`).
 * @param instance - The {@link Knex} handle.
 * @param ids - Candidate `pages.id` values.
 * @param urls - The corresponding `pages.url` values, in the same order as
 *   `ids`. Length and indexing MUST match `ids` so the page → url join can be
 *   reconstructed without a second `pages` round-trip.
 * @returns `Map<pageId, FailedPageMessage>` populated only for ids whose
 *   message was found in one of the consulted tables.
 * @example
 * ```ts
 * const messages = await getFailedPageMessages(
 *   instance,
 *   candidates.map(c => c.id),
 *   candidates.map(c => c.url),
 * );
 * ```
 */
export async function getFailedPageMessages(
	instance: Knex,
	ids: readonly number[],
	urls: readonly string[],
): Promise<Map<number, FailedPageMessage>> {
	if (ids.length === 0) {
		return new Map();
	}
	if (ids.length !== urls.length) {
		throw new Error(
			`getFailedPageMessages: ids.length (${ids.length}) !== urls.length (${urls.length}) — must be 1:1`,
		);
	}

	const messageByPageId = new Map<number, FailedPageMessage>();

	if (await instance.schema.hasTable('page_errors')) {
		for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
			const chunk = ids.slice(i, i + CHUNK_SIZE);
			// `orderBy('id', 'asc')` makes the per-pageId "first row seen"
			// behavior deterministic regardless of SQLite's natural ROWID
			// scan order, which is otherwise implementation-defined under
			// concurrent / migrated archives. Without the explicit order, a
			// reset that classified a page as `unknown` once could classify
			// it as `parse-error` on the next run when the rows happen to be
			// returned in a different order.
			const rows = (await instance('page_errors')
				.select('pageId', 'message', 'createdAt')
				.whereIn('pageId', chunk)
				.orderBy('id', 'asc')) as {
				pageId: number;
				message: string;
				createdAt: number;
			}[];
			for (const row of rows) {
				// Earliest-id wins. Schema permits multiple rows per pageId
				// (the same scrape can record several phase errors); the
				// first row inserted is usually the trigger cause, later
				// rows are follow-on noise from the same failure cascade.
				//
				// An empty `message` is treated as "no signal" and ignored
				// so the crawl_errors lookup can fill it in. Without this,
				// a page_errors row with `message=''` (recorded by a
				// scraper phase that fired its trigger but had no error
				// text) would short-circuit and we'd lose access to the
				// crawl_errors row that classifies the failure as
				// `dns` / `tls` / `client-blocked` etc. — defeating
				// `--retry-failed`'s permanent-kind exclusion.
				if (row.message !== '' && !messageByPageId.has(row.pageId)) {
					messageByPageId.set(row.pageId, {
						message: row.message,
						createdAt: row.createdAt,
					});
				}
			}
		}
	}

	const idsMissing = ids.filter((id) => !messageByPageId.has(id));
	if (idsMissing.length === 0 || !(await instance.schema.hasTable('crawl_errors'))) {
		// Early-exit short-circuits BOTH the idToUrl Map construction and
		// the crawl_errors round-trip. On a 1M-page archive where every
		// failed page already has a `page_errors` row, this avoids walking
		// the candidate list a second time.
		return messageByPageId;
	}

	const idToUrl = new Map<number, string>();
	for (const [i, id] of ids.entries()) {
		const url = urls[i];
		if (url !== undefined) {
			idToUrl.set(id, url);
		}
	}

	const missingUrls: string[] = [];
	for (const id of idsMissing) {
		const url = idToUrl.get(id);
		if (url !== undefined) {
			missingUrls.push(url);
		}
	}
	const urlToMessage = new Map<string, FailedPageMessage>();
	for (let i = 0; i < missingUrls.length; i += CHUNK_SIZE) {
		const chunk = missingUrls.slice(i, i + CHUNK_SIZE);
		const rows = (await instance('crawl_errors')
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
			// Latest-createdAt wins (fixes a previously-undefined
			// selection among duplicate URLs — SQLite's natural scan
			// order is implementation-defined). The most recent message
			// is the most relevant one for both classification and outage
			// attribution: an old NXDOMAIN followed by a network-outage
			// blip should resolve to the outage-era message, not whichever
			// happened to be inserted first.
			const existing = urlToMessage.get(row.url);
			if (existing === undefined || row.createdAt > existing.createdAt) {
				urlToMessage.set(row.url, { message: row.message, createdAt: row.createdAt });
			}
		}
	}
	for (const id of idsMissing) {
		const url = idToUrl.get(id);
		if (url === undefined) {
			continue;
		}
		const resolved = urlToMessage.get(url);
		if (resolved !== undefined) {
			messageByPageId.set(id, resolved);
		}
	}

	return messageByPageId;
}
