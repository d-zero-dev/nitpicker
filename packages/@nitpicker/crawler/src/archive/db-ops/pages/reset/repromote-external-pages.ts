import type { DB_Page } from '../../../types.js';
import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';
import type { Knex } from 'knex';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import { findScopeEntry } from '../../../../crawler/find-scope-entry.js';
import { dbLog } from '../../../debug.js';

import { makeMetaResetPayload } from './make-meta-reset-payload.js';

/**
 * Promote previously-external pages whose URL falls under any of the new scope
 * entries back to a "needs scraping" state so that the next crawl picks them up
 * as full internal pages.
 *
 * For each matching page:
 * - clears the scrape metadata (status, headers, snapshot path, etc.),
 * - flips `isExternal` to `0` and `scraped` to `0`,
 * - removes stale `anchors`, `images`, and `resources-referrers` rows so that
 *   the re-scrape can re-insert fresh ones without duplicates.
 *
 * The page row itself is kept (id is preserved) so existing referrers via
 * `anchors.hrefId` remain valid. SELECT and UPDATE/DELETE statements are
 * chunked to stay below SQLite's `SQLITE_LIMIT_VARIABLE_NUMBER`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param scopes - The hostname-indexed scope map after the new roots are merged.
 * @param options - URL parsing options forwarded to {@link findScopeEntry}.
 * @returns The URLs of the pages that were promoted.
 */
export async function repromoteExternalPages(
	knex: Knex,
	scopes: ReadonlyMap<string, readonly ExURL[]>,
	options?: ParseURLOptions,
): Promise<string[]> {
	if (scopes.size === 0) {
		return [];
	}
	const candidates = await knex
		.select('id', 'url')
		.from<DB_Page>('pages')
		.where('isExternal', 1);

	const promotedIds: number[] = [];
	const promotedUrls: string[] = [];
	for (const row of candidates) {
		const parsed = parseUrl(row.url, options);
		if (!parsed) {
			continue;
		}
		if (findScopeEntry(parsed, scopes, options) === null) {
			continue;
		}
		promotedIds.push(row.id);
		promotedUrls.push(row.url);
	}
	if (promotedIds.length === 0) {
		return [];
	}

	const chunkSize = 500;
	const metaReset = makeMetaResetPayload();
	for (let i = 0; i < promotedIds.length; i += chunkSize) {
		const chunk = promotedIds.slice(i, i + chunkSize);
		await knex<DB_Page>('pages')
			.whereIn('id', chunk)
			.update({
				scraped: 0,
				isExternal: 0,
				isSkipped: 0,
				skipReason: null,
				status: null,
				statusText: null,
				contentType: null,
				contentLength: null,
				responseHeaders: '{}',
				redirectDestId: null,
				// Null every flat meta column + denormalised aggregates +
				// meta_extras. `firstCrawledAt` / `lastCrawledAt` are
				// deliberately omitted from META_NULLABLE_COLUMNS — the
				// last-success timestamp survives the demotion.
				...metaReset,
			});
		// Clear the prior crawl's data for the repromoted pages. `updatePage`
		// also replaces anchors/images/tags/jsonld when it re-scrapes them, but
		// only when the new scrape is non-empty — so this pre-clear is still
		// load-bearing for pages that get repromoted but then re-scrape to
		// nothing (or are never reached again), and it is the only place
		// `resources-referrers` is cleared. The HTML body ref is also cleared
		// so a repromoted page whose re-scrape ends up degraded does not keep
		// its old external-render snapshot. `page_tags` / `page_jsonld` are
		// cleared explicitly even though both tables also carry ON DELETE
		// CASCADE — we keep the existing pattern of explicit chunked DELETEs
		// rather than relying on CASCADE indirectly (and would not cascade
		// anyway: the parent `pages` row is updated, not deleted). Orphan
		// blobs in `page_html_blobs` are left behind; #23 will add GC.
		await knex('anchors').whereIn('pageId', chunk).delete();
		await knex('images').whereIn('pageId', chunk).delete();
		await knex('resources-referrers').whereIn('pageId', chunk).delete();
		await knex('page_html_ref').whereIn('page_id', chunk).delete();
		await knex('page_tags').whereIn('pageId', chunk).delete();
		await knex('page_jsonld').whereIn('pageId', chunk).delete();
	}
	dbLog('Repromoted %d external pages back to pending', promotedUrls.length);
	return promotedUrls;
}
