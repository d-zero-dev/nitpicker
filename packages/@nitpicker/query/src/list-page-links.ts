import type {
	ListPageLinksOptions,
	PageLinkEntry,
	PaginatedPageLinkList,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyListOrder } from './apply-list-order.js';
import { paginateQuery } from './paginate-query.js';

/**
 * Lists per-page network info — one row per page — mirroring the
 * google-sheets "Links" sheet: URL, title, status, status text, content type,
 * redirect-from count, referrer (incoming-link) count, whether response
 * headers were stored, and the skip reason (Remarks).
 *
 * Unlike `listLinks` (which analyzes anchors for broken/external/orphaned
 * links), this lists every page. Redirect-from is still computed via a
 * per-row correlated subquery (cheap — redirect rows are sparse). Referrer
 * counts are resolved THROUGH redirects, so a link to a redirect source
 * (e.g. `http://x` 301-ing to `https://x`) counts toward the final destination
 * — backlinks stay merged on the canonical page instead of splitting (#71).
 *
 * **Performance.** Without a precomputed referrer-count map (the CLI / MCP
 * default), this query runs the referrer count as a per-row correlated
 * subquery — strictly the right shape for `limit=100` but dominated by the
 * anchor JOIN it triggers per page (~33 s on a 10 GB archive). The viewer
 * caches a single `Map<pageId, referrerCount>` per archive at first call
 * and passes it in via `options.precomputedReferrerCounts`; the SQL then
 * collapses to a single index seek per row plus a Map lookup, taking the
 * query sub-second.
 * @param accessor - The archive accessor to query.
 * @param options - Filter and pagination options.
 * @returns A paginated list of per-page network entries.
 */
export async function listPageLinks(
	accessor: ArchiveAccessor,
	options: ListPageLinksOptions = {},
): Promise<PaginatedPageLinkList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const precomputedReferrerCounts = options.precomputedReferrerCounts;

	// Lists every page (redirect targets only), regardless of `scraped` — this
	// matches the google-sheets "Links" sheet, which lists skipped pages too
	// (surfaced via the Remarks column). The row set is intentionally broader
	// than `listPages`, which requires `scraped = 1`.
	const baseQuery = knex('pages').whereNull('redirectDestId');

	if (options.isExternal != null) {
		baseQuery.where('isExternal', options.isExternal ? 1 : 0);
	}
	if (options.urlPattern) {
		baseQuery.where('url', 'like', options.urlPattern);
	}
	if (options.contentType) {
		baseQuery.where('contentType', 'like', `${options.contentType}%`);
	}
	if (options.hasResponseHeaders != null) {
		if (options.hasResponseHeaders) {
			baseQuery
				.whereNotNull('responseHeaders')
				.whereNot('responseHeaders', '')
				.whereNot('responseHeaders', '{}');
		} else {
			baseQuery.where((qb) => {
				qb.whereNull('responseHeaders')
					.orWhere('responseHeaders', '')
					.orWhere('responseHeaders', '{}');
			});
		}
	}
	const sortBy = options.sortBy ?? 'url';
	const sortOrder = options.sortOrder ?? 'asc';
	const useUrlSort = options.sortBy != null;

	return paginateQuery<
		{
			id: number;
			url: string;
			title: string | null;
			status: number | null;
			statusText: string | null;
			contentType: string | null;
			isExternal: 0 | 1;
			responseHeaders: string | null;
			isSkipped: 0 | 1;
			skipReason: string | null;
			redirectFromCount: number;
			referrerCount: number | null;
		},
		PageLinkEntry
	>({
		baseQuery,
		countColumn: 'id',
		applySelect: (q) => {
			const selects: unknown[] = [
				'id',
				'url',
				'title',
				'status',
				'statusText',
				'contentType',
				'isExternal',
				'responseHeaders',
				'isSkipped',
				'skipReason',
				knex.raw(
					'(select count(*) from "pages" as "r" where "r"."redirectDestId" = "pages"."id") as redirectFromCount',
				),
			];
			if (precomputedReferrerCounts === undefined) {
				// Fallback: the per-row correlated subquery. Same shape as
				// before the precompute-cache landed — kept for CLI / MCP
				// callers that don't carry a viewer-side cache.
				selects.push(
					knex.raw(
						'(select count(*) from "anchors" join "pages" as "t" on "anchors"."hrefId" = "t"."id" where coalesce("t"."redirectDestId", "t"."id") = "pages"."id") as referrerCount',
					),
				);
			}
			q.select(...(selects as Parameters<typeof q.select>));
			return applyListOrder(q, knex, sortBy, sortOrder, {
				url: { column: '"pages"."url"', type: useUrlSort ? 'url' : 'plain' },
				title: { column: '"pages"."title"' },
				status: { column: '"pages"."status"' },
				statusText: { column: '"pages"."statusText"' },
				contentType: { column: '"pages"."contentType"' },
				redirectFromCount: { column: '"redirectFromCount"' },
				referrerCount: { column: '"referrerCount"' },
				hasResponseHeaders: { column: '"pages"."responseHeaders"' },
				skipReason: { column: '"pages"."skipReason"' },
				isExternal: { column: '"pages"."isExternal"' },
			});
		},
		limit,
		offset,
		mapRow: (row) => ({
			url: row.url,
			title: row.title,
			status: row.status,
			statusText: row.statusText,
			contentType: row.contentType,
			isExternal: !!row.isExternal,
			redirectFromCount: Number(row.redirectFromCount),
			referrerCount:
				precomputedReferrerCounts === undefined
					? Number(row.referrerCount)
					: // `Number(row.id)` guards against libsql returning `id`
						// as a BigInt on archives whose `pages.id` has grown past
						// 2^53. The cache Map is built with Number keys
						// (`referrer-count-cache.ts` calls `Number(canonicalId)`)
						// so the lookup MUST use the same numeric kind, else
						// every row would silently render `referrerCount = 0`.
						(precomputedReferrerCounts.get(Number(row.id)) ?? 0),
			hasResponseHeaders:
				row.responseHeaders != null &&
				row.responseHeaders !== '' &&
				row.responseHeaders !== '{}',
			skipReason: row.isSkipped ? (row.skipReason ?? 'skipped') : null,
		}),
	});
}
