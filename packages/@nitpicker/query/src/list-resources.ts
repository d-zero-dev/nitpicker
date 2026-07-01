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
 * Columns mirror the google-sheets "Resources" sheet (URL, Status Code,
 * Status Text, Content Type, Content Length, Referrers). `referrerCount`
 * is computed with a correlated subquery so it does not perturb the
 * pagination COUNT.
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

	const baseQuery = knex('resources');

	if (options.urlPattern) {
		baseQuery.where('url', 'like', options.urlPattern);
	}
	if (options.contentType) {
		baseQuery.where('contentType', 'like', `${options.contentType}%`);
	}
	if (options.isExternal != null) {
		baseQuery.where('isExternal', options.isExternal ? 1 : 0);
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
			compress: string | 0;
			cdn: string | 0;
			referrerCount: number;
		},
		ResourceEntry
	>({
		baseQuery,
		countColumn: 'id',
		applySelect: (q) => {
			q.select(
				'url',
				'status',
				'statusText',
				'contentType',
				'contentLength',
				'isExternal',
				'compress',
				'cdn',
				knex.raw(
					'(select count(*) from "resources-referrers" where "resources-referrers"."resourceId" = "resources"."id") as referrerCount',
				),
			);
			return applyListOrder(q, knex, sortBy, sortOrder, {
				url: { column: '"resources"."url"', type: useUrlSort ? 'url' : 'plain' },
				status: { column: '"resources"."status"' },
				statusText: { column: '"resources"."statusText"' },
				contentType: { column: '"resources"."contentType"' },
				contentLength: { column: '"resources"."contentLength"' },
				isExternal: { column: '"resources"."isExternal"' },
				referrerCount: { column: '"referrerCount"' },
				compress: { column: '"resources"."compress"' },
				cdn: { column: '"resources"."cdn"' },
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
			compress: row.compress === 0 ? null : row.compress,
			cdn: row.cdn === 0 ? null : row.cdn,
		}),
	});
}
