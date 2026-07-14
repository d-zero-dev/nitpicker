import type {
	ListResourcesOptions,
	PaginatedResourceList,
	ResourceEntry,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyListOrder } from './apply-list-order.js';
import { paginateQuery } from './paginate-query.js';

/**
 * Lists sub-resources (CSS, JS, images, fonts, etc.) from the archive
 * with optional filtering by content type and origin.
 *
 * Phase 6-F: reads the Phase 6-C `resource_items` entity table (joined to
 * `url_refs` for the URL and `content_type_refs` for the MIME) instead of
 * the legacy `resources` table. `referrerCount` is computed via a
 * correlated `SUM("count")` subquery over `resource_ref_edges`
 * (Phase 6-D populates one edge row per unique referrer with `count = 1`,
 * so the sum equals the pre-Phase-6 `COUNT(*)` over `resources-referrers`).
 * `compress` / `cdn` are inline TEXT-affinity columns on `resource_items`
 * that preserve the `'0.0'` / `0` sentinels the pre-6 writer path emitted.
 * @param accessor - The archive accessor to query.
 * @param options - Filter and pagination options.
 * @returns A paginated list of resource entries.
 */
export async function listResources(
	accessor: ArchiveAccessor,
	options: ListResourcesOptions = {},
): Promise<PaginatedResourceList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	const baseQuery = knex('resource_items as ri')
		.join('url_refs as ur', 'ur.id', 'ri.url_id')
		.leftJoin('content_type_refs as ctr', 'ctr.id', 'ri.content_type_id');

	if (options.urlPattern) {
		baseQuery.where('ur.url', 'like', options.urlPattern);
	}
	if (options.status != null) {
		baseQuery.where('ri.status', options.status);
	}
	if (options.contentType) {
		baseQuery.where('ctr.raw', 'like', `${options.contentType}%`);
	}
	if (options.isExternal != null) {
		baseQuery.where('ri.is_external', options.isExternal ? 1 : 0);
	}
	const sortBy = options.sortBy ?? 'url';
	const sortOrder = options.sortOrder ?? 'asc';
	const useUrlSort = options.sortBy != null;

	return paginateQuery<
		{
			url: string;
			status: number | null;
			statusText: string | null;
			contentType: string | null;
			contentLength: number | null;
			isExternal: 0 | 1;
			compress: string | 0 | '0.0';
			cdn: string | 0 | '0.0';
			referrerCount: number;
		},
		ResourceEntry
	>({
		baseQuery,
		countColumn: 'ri.id',
		applySelect: (q) => {
			q.select(
				'ur.url as url',
				'ri.status as status',
				'ri.status_text as statusText',
				'ctr.raw as contentType',
				'ri.content_length as contentLength',
				'ri.is_external as isExternal',
				'ri.compress as compress',
				'ri.cdn as cdn',
				knex.raw(
					'coalesce((select sum("count") from "resource_ref_edges" where "resource_ref_edges"."resource_id" = "ri"."id"), 0) as referrerCount',
				),
			);
			return applyListOrder(q, knex, sortBy, sortOrder, {
				url: { column: '"ur"."url"', type: useUrlSort ? 'url' : 'plain' },
				status: { column: '"ri"."status"' },
				statusText: { column: '"ri"."status_text"' },
				contentType: { column: '"ctr"."raw"' },
				contentLength: { column: '"ri"."content_length"' },
				isExternal: { column: '"ri"."is_external"' },
				referrerCount: { column: '"referrerCount"' },
				compress: { column: '"ri"."compress"' },
				cdn: { column: '"ri"."cdn"' },
			});
		},
		limit,
		offset,
		mapRow: (row) => ({
			url: row.url,
			status: row.status,
			statusText: row.statusText,
			contentType: row.contentType,
			contentLength: row.contentLength,
			isExternal: !!row.isExternal,
			referrerCount: Number(row.referrerCount),
			compress: row.compress === 0 || row.compress === '0.0' ? null : row.compress,
			cdn: row.cdn === 0 || row.cdn === '0.0' ? null : row.cdn,
		}),
	});
}
