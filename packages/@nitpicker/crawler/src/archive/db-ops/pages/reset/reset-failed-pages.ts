import type { DB_Page } from '../../../types.js';
import type { Knex } from 'knex';

import { classifyErrorKind } from '../../../../classify-error-kind.js';
import { PERMANENT_ERROR_KINDS } from '../../../../permanent-error-kinds.js';
import { dbLog } from '../../../debug.js';
import { getFailedPageMessages } from '../../../get-failed-page-messages.js';

import { makeMetaResetPayload } from './make-meta-reset-payload.js';

/**
 * Reset previously-attempted pages that ended in a recoverable failure so a
 * follow-up crawl can re-fetch them from scratch.
 *
 * A page qualifies as a recoverable failure when it was already scraped
 * (`scraped = 1`), is not a redirect source (`redirectDestId IS NULL`), was
 * not intentionally skipped (`isSkipped` is not `1`), and one of the
 * following holds:
 *
 * - `status = -1` — the sentinel a hard scrape failure (network error,
 *   timeout, browser crash) is recorded with (see `handle-scrape-error.ts`);
 * - `status IS NULL` — no status was ever stored for the row;
 * - `contentType IS NULL` — the content type could not be determined;
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
 * Matching rows — internal and external alike — are demoted back to pending
 * (`scraped = 0`) and have their stale scrape metadata cleared. The page row
 * itself is kept (id preserved) so existing `anchors.hrefId` referrers stay
 * valid, and `isExternal` is left untouched so the next pass re-classifies
 * each page from the crawl scope. Related `anchors`, `images`,
 * `resources-referrers`, and `page_errors` rows are deleted so the re-scrape
 * can re-insert fresh data without duplicates.
 *
 * SELECT and UPDATE/DELETE statements are chunked to stay below SQLite's
 * `SQLITE_LIMIT_VARIABLE_NUMBER`.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns The URLs of the pages that were reset to pending.
 */
export async function resetFailedPages(knex: Knex): Promise<string[]> {
	const candidates = await knex
		.select('id', 'url')
		.from<DB_Page>('pages')
		.where('scraped', 1)
		.whereNull('redirectDestId')
		.where((qb) => {
			qb.where('isSkipped', 0).orWhereNull('isSkipped');
		})
		.where((qb) => {
			qb.whereNull('status')
				.orWhere('status', -1)
				.orWhereNull('contentType')
				.orWhereBetween('status', [500, 599]);
		});

	if (candidates.length === 0) {
		return [];
	}

	const candidateIds = candidates.map((row) => row.id);
	const candidateUrls = candidates.map((row) => row.url);
	const messages = await getFailedPageMessages(knex, candidateIds, candidateUrls);
	// Drop candidates whose latest recorded message classifies as permanent.
	// An empty/absent message stays in the retry pool — we keep retrying when
	// we don't know it's permanent, erring on the side of investigation.
	const retryable = candidates.filter((row) => {
		const message = messages.get(row.id) ?? '';
		if (message === '') {
			return true;
		}
		return !PERMANENT_ERROR_KINDS.has(classifyErrorKind(message));
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
	const metaReset = makeMetaResetPayload();
	for (let i = 0; i < ids.length; i += chunkSize) {
		const chunk = ids.slice(i, i + chunkSize);
		await knex<DB_Page>('pages')
			.whereIn('id', chunk)
			.update({
				scraped: 0,
				status: null,
				statusText: null,
				contentType: null,
				contentLength: null,
				responseHeaders: '{}',
				// Null every flat meta column + denormalised aggregates +
				// meta_extras. `firstCrawledAt` / `lastCrawledAt` are
				// deliberately omitted from META_NULLABLE_COLUMNS so the
				// last-success timestamp records survive the demotion (the
				// within-archive observation axis for #11/#17/#19).
				...metaReset,
			});
		// Clear the prior crawl's per-page data so the re-scrape starts clean.
		// `updatePage` only replaces anchors/images/tags/jsonld when the new
		// scrape is non-empty, so this pre-clear is load-bearing for pages that
		// reset but then fail again (or are never reached), and it is the only
		// place `resources-referrers` and `page_errors` are cleared. The HTML
		// body ref is also cleared so a previously-rendered page that now fails
		// to re-scrape does not keep its old snapshot.
		await knex('anchors').whereIn('pageId', chunk).delete();
		await knex('images').whereIn('pageId', chunk).delete();
		await knex('resources-referrers').whereIn('pageId', chunk).delete();
		await knex('page_errors').whereIn('pageId', chunk).delete();
		await knex('page_html_ref').whereIn('page_id', chunk).delete();
		await knex('page_tags').whereIn('pageId', chunk).delete();
		await knex('page_jsonld').whereIn('pageId', chunk).delete();
	}
	dbLog('Reset %d failed pages back to pending', urls.length);
	return urls;
}
