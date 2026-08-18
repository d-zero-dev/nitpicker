import type { Knex } from 'knex';

import { classifyErrorKind } from '../../../../classify-error-kind.js';
import { isWithinOutageWindow } from '../../../../is-within-outage-window.js';
import { PERMANENT_ERROR_KINDS } from '../../../../permanent-error-kinds.js';
import { dbLog } from '../../../debug.js';
import { getFailedPageMessages } from '../../../get-failed-page-messages.js';
import { listNetworkOutages } from '../../outages/list-network-outages.js';

/**
 * Reset previously-attempted pages that ended in a recoverable failure so a
 * follow-up crawl can re-fetch them from scratch.
 *
 * A page qualifies as a recoverable failure when it was already scraped
 * (`scraped = 1`), is not a redirect source (`redirect_dest_id IS NULL`), was
 * not intentionally skipped (`is_skipped` is not `1`), and one of the
 * following holds:
 *
 * - `status = -1` — the sentinel a hard scrape failure (network error,
 *   timeout, browser crash) is recorded with (see `handle-scrape-error.ts`);
 * - `status IS NULL` — no status was ever stored for the row;
 * - the row has no `content_type_refs` link — the content type could not be
 *   determined;
 * - `status` is in the `5xx` range — a (frequently transient) server error.
 *
 * Definitive `4xx` responses are intentionally excluded: re-fetching a 404
 * almost always yields the same answer.
 *
 * A second exclusion runs in JS after the SQL candidate scan: any page whose
 * latest recorded `page_errors` / `crawl_errors` message classifies into a
 * permanent {@link PERMANENT_ERROR_KINDS} kind (dns / tls / client-blocked /
 * parse-error / connection-refused) is left as-is rather than reset to
 * pending. Without this filter, `--retry-failed` never converges: NXDOMAIN
 * hosts, expired-cert hosts, and `ERR_BLOCKED_BY_CLIENT` ad pixels would be
 * reset every iteration, re-attempted, fail identically, and rejoin the
 * candidate pool for the next iteration. The exclusion keeps the retry
 * target shrinking across `--retry-failed` passes by leaving deterministic
 * dead-ends alone.
 *
 * **Outage override**: before applying the permanent-kind exclusion, the
 * message's `createdAt` is checked against every recorded
 * `network_outages` window (see `is-within-outage-window.ts`). A `dns` (or
 * any other permanent-kind) failure whose timestamp falls inside a window
 * is treated as retryable regardless — `dns` is only a permanent,
 * site-specific verdict when nothing else explains it; inside a confirmed
 * operator-network outage, the same `getaddrinfo ENOTFOUND` message is
 * evidence about the CRAWLER's connectivity, not the target site, and
 * excluding it from retry would strand a perfectly reachable host as a
 * false permanent failure for the rest of the archive's life. An archive
 * with no recorded outages (`listNetworkOutages` returns `[]`) behaves
 * exactly as before this override existed.
 *
 * Matching rows — internal and external alike — are demoted back to pending
 * (`scraped = 0`) and have their stale scrape metadata cleared (the
 * `page_meta` row is deleted outright rather than nulled column-by-column).
 * The page row itself is kept (id preserved) so existing
 * `anchor_edges.href_page_id` referrers stay valid, and `is_external` is
 * left untouched so the next pass re-classifies each page from the crawl
 * scope. Related `anchor_edges`, `image_items`, `resource_ref_edges`,
 * `page_errors`, and the `page_main_content_*` child tables are deleted so
 * the re-scrape can re-insert fresh data without duplicates — kept in sync
 * with the `page_meta` row deletion above so a reset page's `main_content_*`
 * counts and its child-table detail never disagree.
 *
 * SELECT and UPDATE/DELETE statements are chunked to stay below SQLite's
 * `SQLITE_LIMIT_VARIABLE_NUMBER`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param onProgress - Called after each chunk's DELETE/UPDATE statements
 *   complete, with the pages processed so far and the total to reset (issue
 *   #294: a large `--retry-failed` can reset thousands of pages across 13
 *   tables, running for seconds to minutes with no other signal it hasn't
 *   hung). Omit for no reporting (the default; e.g. tests).
 * @returns The URLs of the pages that were reset to pending.
 */
export async function resetFailedPages(
	knex: Knex,
	onProgress?: (processed: number, total: number) => void,
): Promise<string[]> {
	const candidates = await knex('content_items')
		.join('url_refs', 'content_items.url_id', 'url_refs.id')
		.select('content_items.id as id', 'url_refs.url as url')
		.where('content_items.scraped', 1)
		.whereNull('content_items.redirect_dest_id')
		.where((qb) => {
			qb.where('content_items.is_skipped', 0).orWhereNull('content_items.is_skipped');
		})
		.where((qb) => {
			qb.whereNull('content_items.status')
				.orWhere('content_items.status', -1)
				.orWhereNull('content_items.content_type_id')
				.orWhereBetween('content_items.status', [500, 599]);
		});

	if (candidates.length === 0) {
		return [];
	}

	const candidateIds = candidates.map((row) => row.id);
	const candidateUrls = candidates.map((row) => row.url);
	// Unrelated tables (page_errors/crawl_errors vs network_outages), no data
	// dependency between them — run concurrently instead of paying two
	// sequential round-trips on every `--retry-failed` pass.
	const [messages, outageWindows] = await Promise.all([
		getFailedPageMessages(knex, candidateIds, candidateUrls),
		listNetworkOutages(knex),
	]);
	// Drop candidates whose latest recorded message classifies as permanent —
	// UNLESS that message's timestamp falls inside a recorded network outage,
	// in which case the permanent-kind verdict is overridden (see the
	// "Outage override" section of this function's docstring). An
	// empty/absent message stays in the retry pool regardless — we keep
	// retrying when we don't know it's permanent, erring on the side of
	// investigation.
	const retryable = candidates.filter((row) => {
		const resolved = messages.get(row.id);
		if (resolved === undefined || resolved.message === '') {
			return true;
		}
		if (!PERMANENT_ERROR_KINDS.has(classifyErrorKind(resolved.message))) {
			return true;
		}
		return isWithinOutageWindow(resolved.createdAt, outageWindows);
	});
	const excludedCount = candidates.length - retryable.length;
	if (excludedCount > 0) {
		dbLog(
			'Excluded %d page(s) from retry — permanent failure kinds (dns/tls/client-blocked/parse-error/connection-refused)',
			excludedCount,
		);
	}
	if (retryable.length === 0) {
		return [];
	}

	const ids = retryable.map((row) => row.id);
	const urls = retryable.map((row) => row.url);

	const chunkSize = 500;
	for (let i = 0; i < ids.length; i += chunkSize) {
		const chunk = ids.slice(i, i + chunkSize);
		await knex('content_items').whereIn('id', chunk).update({
			scraped: 0,
			status: null,
			status_text: null,
			content_type_id: null,
			content_length: null,
			header_set_id: null,
			// `first_crawled_at` / `last_crawled_at` are deliberately left
			// untouched so the last-success timestamp records survive the
			// demotion (the within-archive observation axis for #11/#17/#19).
		});
		// Clear the prior crawl's per-page data so the re-scrape starts clean.
		// `updatePage` only replaces anchor_edges/image_items/tags/jsonld when
		// the new scrape is non-empty, so this pre-clear is load-bearing for
		// pages that reset but then fail again (or are never reached), and it
		// is the only place `resource_ref_edges` and `page_errors` are
		// cleared. Deleting the `page_meta` row (rather than nulling every
		// column) clears title / description / og:* / twitter:* /
		// meta_extras in one statement; a re-scrape re-inserts it via
		// `ON CONFLICT(page_id) DO UPDATE`.
		await knex('page_meta').whereIn('page_id', chunk).delete();
		await knex('anchor_edges').whereIn('page_id', chunk).delete();
		await knex('image_items').whereIn('page_id', chunk).delete();
		await knex('resource_ref_edges').whereIn('page_id', chunk).delete();
		await knex('page_errors').whereIn('pageId', chunk).delete();
		await knex('page_html_ref').whereIn('page_id', chunk).delete();
		await knex('technology_signals').whereIn('pageId', chunk).delete();
		await knex('page_technologies').whereIn('pageId', chunk).delete();
		await knex('page_jsonld').whereIn('pageId', chunk).delete();
		await knex('page_main_content_headings').whereIn('pageId', chunk).delete();
		await knex('page_main_content_images').whereIn('pageId', chunk).delete();
		await knex('page_main_content_tables').whereIn('pageId', chunk).delete();
		await knex('page_main_content_buttons').whereIn('pageId', chunk).delete();
		await knex('page_main_content_iframes').whereIn('pageId', chunk).delete();
		await knex('page_main_content_videos').whereIn('pageId', chunk).delete();
		await knex('page_main_content_audios').whereIn('pageId', chunk).delete();
		await knex('page_main_content_canvases').whereIn('pageId', chunk).delete();
		await knex('page_main_content_custom_elements').whereIn('pageId', chunk).delete();
		onProgress?.(Math.min(i + chunkSize, ids.length), ids.length);
	}
	dbLog('Reset %d failed pages back to pending', urls.length);
	return urls;
}
