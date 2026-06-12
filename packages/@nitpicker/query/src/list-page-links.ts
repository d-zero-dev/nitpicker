import type {
	ListPageLinksOptions,
	PageLinkEntry,
	PaginatedPageLinkList,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { paginateQuery } from './paginate-query.js';

/**
 * Lists per-page network info — one row per page — mirroring the
 * google-sheets "Links" sheet: URL, title, status, status text, content type,
 * redirect-from count, referrer (incoming-link) count, whether response
 * headers were stored, and the skip reason (Remarks).
 *
 * Unlike `listLinks` (which analyzes anchors for broken/external/orphaned
 * links), this lists every page. Redirect-from and referrer counts use
 * correlated subqueries so they do not perturb the pagination COUNT.
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

	return paginateQuery<
		{
			url: string;
			title: string | null;
			status: number | null;
			statusText: string | null;
			contentType: string | null;
			responseHeaders: string | null;
			isSkipped: 0 | 1;
			skipReason: string | null;
			redirectFromCount: number;
			referrerCount: number;
		},
		PageLinkEntry
	>({
		baseQuery,
		countColumn: 'id',
		applySelect: (q) =>
			q
				.select(
					'url',
					'title',
					'status',
					'statusText',
					'contentType',
					'responseHeaders',
					'isSkipped',
					'skipReason',
					knex.raw(
						'(select count(*) from "pages" as "r" where "r"."redirectDestId" = "pages"."id") as redirectFromCount',
					),
					knex.raw(
						'(select count(*) from "anchors" where "anchors"."hrefId" = "pages"."id") as referrerCount',
					),
				)
				.orderBy('url'),
		limit,
		offset,
		mapRow: (row) => ({
			url: row.url,
			title: row.title,
			status: row.status,
			statusText: row.statusText,
			contentType: row.contentType,
			redirectFromCount: Number(row.redirectFromCount),
			referrerCount: Number(row.referrerCount),
			hasResponseHeaders:
				row.responseHeaders != null &&
				row.responseHeaders !== '' &&
				row.responseHeaders !== '{}',
			skipReason: row.isSkipped ? (row.skipReason ?? 'skipped') : null,
		}),
	});
}
