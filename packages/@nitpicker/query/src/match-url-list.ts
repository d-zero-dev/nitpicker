import type { UrlMatchResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { eachSplitted } from '@nitpicker/crawler';

import { normalizeArchiveUrl } from './normalize-archive-url.js';
import { SQLITE_IN_CHUNK } from './sqlite-in-chunk.js';

/** Row shape read from the `content_items` join, keyed by its own normalized URL. */
interface MatchRow {
	pageId: number;
	normalizedUrl: string;
	status: number | null;
	statusText: string | null;
	contentType: string | null;
	title: string | null;
	isExternal: number;
	isSkipped: number | null;
	skipReason: string | null;
	firstCrawledAt: number | null;
	lastCrawledAt: number | null;
	redirectDestUrl: string | null;
}

/**
 * Matches a list of operator-supplied URLs against the archive, one result
 * per input URL, preserving input order.
 *
 * Reads `content_items`/`url_refs` directly rather than `viewer_pages` (the
 * Page List row set) — this is a diagnostic "is this URL in the archive at
 * all, and in what state" query, so it must also answer for external URLs,
 * non-HTML resources, and skipped pages the Page List row set excludes by
 * design, and it must work even on an archive whose viewer read model was
 * never built. `content_items.redirect_dest_id` is pre-flattened to the
 * final destination at write time (see ARCHITECTURE.md), so resolving
 * {@link UrlMatchResult.redirectDestUrl} costs one `LEFT JOIN`, not a
 * chain-walk. `alias_of_id` is deliberately not resolved here — this
 * function answers "does a row for this exact URL exist", not "what page
 * does this URL's content represent" (that's `getPageDetail`'s job).
 * @param accessor - The archive accessor to query.
 * @param urls - The operator-supplied URL strings, unparsed, in the order to
 *   preserve in the result.
 * @returns One {@link UrlMatchResult} per entry in `urls`, in the same order
 *   (including an entry for a URL that could not be normalized, or that
 *   normalized to a URL with no matching row).
 * @example
 * const results = await matchUrlList(accessor, ['https://example.com/a', 'https://example.com/missing']);
 * const notFound = results.filter((r) => !r.found);
 */
export async function matchUrlList(
	accessor: ArchiveAccessor,
	urls: readonly string[],
): Promise<UrlMatchResult[]> {
	const { disableQueries } = await accessor.getConfig();
	const normalizedByInput = new Map<string, string | null>();
	for (const url of urls) {
		if (!normalizedByInput.has(url)) {
			normalizedByInput.set(url, normalizeArchiveUrl(url, disableQueries));
		}
	}
	const distinctNormalized = [
		...new Set(
			[...normalizedByInput.values()].filter((value): value is string => value !== null),
		),
	];

	const knex = accessor.getKnex();
	const rowsByUrl = new Map<string, MatchRow>();
	await eachSplitted(distinctNormalized, SQLITE_IN_CHUNK, async (chunk) => {
		const rows: MatchRow[] = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
			.leftJoin('page_meta as pm', 'pm.page_id', 'ci.id')
			.leftJoin('text_refs as title_ref', 'title_ref.id', 'pm.title_text_id')
			.leftJoin('content_items as dest', 'dest.id', 'ci.redirect_dest_id')
			.leftJoin('url_refs as dest_ur', 'dest_ur.id', 'dest.url_id')
			.whereIn('ur.url', chunk)
			.select(
				'ci.id as pageId',
				'ur.url as normalizedUrl',
				'ci.status as status',
				'ci.status_text as statusText',
				'ctr.raw as contentType',
				'title_ref.text as title',
				'ci.is_external as isExternal',
				'ci.is_skipped as isSkipped',
				'ci.skip_reason as skipReason',
				'ci.first_crawled_at as firstCrawledAt',
				'ci.last_crawled_at as lastCrawledAt',
				'dest_ur.url as redirectDestUrl',
			);
		for (const row of rows) {
			rowsByUrl.set(row.normalizedUrl, row);
		}
	});

	return urls.map((url) => {
		const normalizedUrl = normalizedByInput.get(url) ?? null;
		const row = normalizedUrl === null ? undefined : rowsByUrl.get(normalizedUrl);
		if (!row) {
			return {
				url,
				normalizedUrl,
				found: false,
				pageId: null,
				status: null,
				statusText: null,
				contentType: null,
				title: null,
				isExternal: null,
				isSkipped: null,
				skipReason: null,
				firstCrawledAt: null,
				lastCrawledAt: null,
				redirectDestUrl: null,
			};
		}
		return {
			url,
			normalizedUrl,
			found: true,
			pageId: row.pageId,
			status: row.status,
			statusText: row.statusText,
			contentType: row.contentType,
			title: row.title,
			isExternal: !!row.isExternal,
			isSkipped: !!row.isSkipped,
			skipReason: row.skipReason,
			firstCrawledAt: row.firstCrawledAt,
			lastCrawledAt: row.lastCrawledAt,
			redirectDestUrl: row.redirectDestUrl,
		};
	});
}
