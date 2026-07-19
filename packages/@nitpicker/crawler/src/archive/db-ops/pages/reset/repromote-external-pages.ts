import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';
import type { Knex } from 'knex';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import { findScopeEntry } from '../../../../crawler/find-scope-entry.js';
import { dbLog } from '../../../debug.js';

/**
 * Promote previously-external pages whose URL falls under any of the new scope
 * entries back to a "needs scraping" state so that the next crawl picks them up
 * as full internal pages.
 *
 * For each matching page:
 * - clears the scrape metadata (status, headers, snapshot path, etc.) by
 *   deleting the `page_meta` row outright (a re-scrape re-inserts it fresh),
 * - flips `is_external` to `0` and `scraped` to `0` on `content_items`,
 * - removes stale `anchor_edges`, `image_items`, and `resource_ref_edges`
 *   rows so that the re-scrape can re-insert fresh ones without duplicates.
 *
 * The page row itself is kept (id is preserved) so existing referrers via
 * `anchor_edges.href_page_id` remain valid. SELECT and UPDATE/DELETE
 * statements are chunked to stay below SQLite's
 * `SQLITE_LIMIT_VARIABLE_NUMBER`.
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
	const candidates = await knex('content_items')
		.join('url_refs', 'content_items.url_id', 'url_refs.id')
		.select('content_items.id as id', 'url_refs.url as url')
		.where('content_items.is_external', 1);

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
	for (let i = 0; i < promotedIds.length; i += chunkSize) {
		const chunk = promotedIds.slice(i, i + chunkSize);
		await knex('content_items').whereIn('id', chunk).update({
			scraped: 0,
			is_external: 0,
			is_skipped: 0,
			skip_reason: null,
			status: null,
			status_text: null,
			content_type_id: null,
			content_length: null,
			header_set_id: null,
			redirect_dest_id: null,
			// `first_crawled_at` / `last_crawled_at` are deliberately
			// left untouched — the last-success timestamp survives the
			// demotion.
		});
		// Clear the prior crawl's data for the repromoted pages. `updatePage`
		// also replaces anchor_edges/image_items/tags/jsonld when it
		// re-scrapes them, but only when the new scrape is non-empty — so
		// this pre-clear is still load-bearing for pages that get
		// repromoted but then re-scrape to nothing (or are never reached
		// again), and it is the only place `resource_ref_edges` is cleared.
		// Deleting the `page_meta` row (rather than nulling every column)
		// clears title / description / og:* / twitter:* / meta_extras in
		// one statement; a re-scrape re-inserts it via
		// `ON CONFLICT(page_id) DO UPDATE`. `page_tags` / `page_jsonld` are
		// cleared explicitly even though both tables also carry ON DELETE
		// CASCADE — we keep the existing pattern of explicit chunked
		// DELETEs rather than relying on CASCADE indirectly (and would not
		// cascade anyway: the parent `content_items` row is updated, not
		// deleted). Orphan blobs in `page_html_blobs` are left behind; #23
		// will add GC.
		await knex('page_meta').whereIn('page_id', chunk).delete();
		await knex('anchor_edges').whereIn('page_id', chunk).delete();
		await knex('image_items').whereIn('page_id', chunk).delete();
		await knex('resource_ref_edges').whereIn('page_id', chunk).delete();
		await knex('page_html_ref').whereIn('page_id', chunk).delete();
		await knex('page_tags').whereIn('pageId', chunk).delete();
		await knex('page_jsonld').whereIn('pageId', chunk).delete();
	}
	dbLog('Repromoted %d external pages back to pending', promotedUrls.length);
	return promotedUrls;
}
