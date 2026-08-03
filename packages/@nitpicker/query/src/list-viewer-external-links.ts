import type {
	ListViewerExternalLinksOptions,
	PaginatedExternalLinkList,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyEqualityOrInFilter } from './apply-equality-or-in-filter.js';
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
 * Same response shape as {@link listExternalLinks}, and the same options
 * modulo `status` accepting an array (OR) here — {@link
 * ListViewerExternalLinksOptions} exists precisely because `listExternalLinks`
 * still filters `status` by single-value equality, so widening the shared
 * options type would let an array reach it unchanged. Callers switch between
 * the two purely based on whether the read model is current (see
 * `register-links-route.ts`). One accepted response-shape difference:
 * `destUrl` sorts by plain `BINARY` collation here
 * (matching `viewer_pages.url_sort_key`'s precedent), not the natural/
 * numeric-aware sort {@link listExternalLinks} uses via
 * `ensureUrlSortTempTable` — the same fast-path/live sort divergence
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
	options: ListViewerExternalLinksOptions = {},
): Promise<PaginatedExternalLinkList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const sortOrder = options.sortOrder ?? 'asc';

	const baseQuery = knex('viewer_external_links');
	if (options.urlPattern) {
		baseQuery
			.join(
				'viewer_url_refs as filter_url',
				'viewer_external_links.dest_url_ref_id',
				'=',
				'filter_url.id',
			)
			.where('filter_url.url', 'like', options.urlPattern);
	}
	applyEqualityOrInFilter(baseQuery, 'status', options.status);

	const sortColumns: Record<'destUrl' | 'status' | 'referrerCount', { column: string }> =
		{
			destUrl: { column: '"viewer_external_links"."dest_url_ref_id"' },
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
				q
					.select(
						'dest_url.url as destUrl',
						'viewer_external_links.status',
						'viewer_external_links.referrer_count as referrerCount',
					)
					.leftJoin(
						'viewer_url_refs as dest_url',
						'viewer_external_links.dest_url_ref_id',
						'=',
						'dest_url.id',
					),
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
		mapRow: (row: {
			destUrl: string | null;
			status: number | null;
			referrerCount: number;
		}) => {
			if (row.destUrl == null) {
				throw new Error(
					'listViewerExternalLinks: missing viewer_url_refs row for external destination',
				);
			}
			return {
				destUrl: row.destUrl,
				status: row.status,
				referrerCount: Number(row.referrerCount),
			};
		},
	});
}
