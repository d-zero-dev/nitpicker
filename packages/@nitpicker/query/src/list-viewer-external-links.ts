import type { ListExternalLinksOptions, PaginatedExternalLinkList } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyListOrder } from './apply-list-order.js';
import { paginateQuery } from './paginate-query.js';

/**
 * Lists unique external destinations from the `viewer_external_links` read
 * model — the fast-path counterpart of {@link listExternalLinks}, backed by
 * a table pre-aggregated once at read-model build time instead of a live
 * `anchors` JOIN + `GROUP BY` per request (see
 * ARCHITECTURE.md「設計注意（viewer_anchor_facts read model、issue #114）」for why the live
 * version's `GROUP BY` + `COUNT(DISTINCT ...)` combination is a known
 * SQLite performance pitfall).
 *
 * Same options/response shape as {@link listExternalLinks} — callers switch
 * between the two purely based on whether the read model is current (see
 * `register-links-route.ts`), with no visible contract difference. One
 * accepted difference: `destUrl` sorts by plain `BINARY` collation here
 * (matching `viewer_pages.url_sort_key`'s precedent), not the natural/
 * numeric-aware sort {@link listExternalLinks} uses via
 * `ensureUrlSortTempTable` — the same fast-path/legacy sort divergence
 * already accepted for `/api/pages`.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current (see
 *   `isViewerReadModelCurrent`) before calling this — it assumes
 *   `viewer_external_links` exists and trusts its content.
 * @param options - Filter, sort, and pagination options.
 * @returns A paginated list of unique external destinations.
 * @example
 * if (await isViewerReadModelCurrent(accessor)) {
 *   const page = await listViewerExternalLinks(accessor, { limit: 100 });
 * }
 */
export async function listViewerExternalLinks(
	accessor: ArchiveAccessor,
	options: ListExternalLinksOptions = {},
): Promise<PaginatedExternalLinkList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const sortOrder = options.sortOrder ?? 'asc';

	const baseQuery = knex('viewer_external_links');
	if (options.urlPattern) {
		baseQuery.where('dest_url', 'like', options.urlPattern);
	}
	if (options.status != null) {
		baseQuery.where('status', options.status);
	}

	const sortColumns: Record<'destUrl' | 'status' | 'referrerCount', { column: string }> =
		{
			destUrl: { column: '"viewer_external_links"."dest_url"' },
			status: { column: '"viewer_external_links"."status"' },
			referrerCount: { column: '"viewer_external_links"."referrer_count"' },
		};
	const sortBy =
		options.sortBy && options.sortBy in sortColumns ? options.sortBy : 'destUrl';

	return paginateQuery({
		baseQuery,
		countColumn: 'dest_page_id',
		applySelect: (q) =>
			applyListOrder(
				q.select('dest_url as destUrl', 'status', 'referrer_count as referrerCount'),
				knex,
				sortBy,
				sortOrder,
				sortColumns,
				// Tiebreaker: mirrors `listExternalLinks`'s `ORDER BY destId asc` —
				// without it, ties on `status`/`referrerCount` make offset
				// pagination duplicate or skip destinations across pages.
			).orderBy('dest_page_id', 'asc'),
		limit,
		offset,
		mapRow: (row: { destUrl: string; status: number | null; referrerCount: number }) => ({
			destUrl: row.destUrl,
			status: row.status,
			referrerCount: Number(row.referrerCount),
		}),
	});
}
