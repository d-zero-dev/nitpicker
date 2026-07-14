import type {
	ListUnusedResourcesOptions,
	PageSource,
	PaginatedUnusedResourceList,
	UnusedResourceEntry,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { applyListOrder } from './apply-list-order.js';

/**
 * Phase 6-F: list internal sub-resources that no archived page references,
 * reading through Phase 6-C `resource_items` + `resource_ref_edges` (the
 * write-model replacements for `resources` + `resources-referrers`) joined
 * to `url_refs` / `content_type_refs` for display columns.
 *
 * "Unused" is judged purely by the presence of any referrer edge:
 * `resource_ref_edges.resource_id IS NULL` (LEFT JOIN miss) means no
 * `page → resource` edge exists. `ri.source` is only returned as a
 * per-row badge, not filtered in the WHERE clause.
 * @param accessor - The archive accessor to query.
 * @param options - Pagination options.
 * @returns Paginated list of unused resources with their `source` badge.
 */
export async function listUnusedResources(
	accessor: ArchiveAccessor,
	options: ListUnusedResourcesOptions = {},
): Promise<PaginatedUnusedResourceList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const sortBy = options.sortBy ?? 'url';
	const sortOrder = options.sortOrder ?? 'asc';
	const useUrlSort = options.sortBy != null;

	const baseWhere = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
		const query = qb
			.leftJoin('resource_ref_edges as rre', 'ri.id', 'rre.resource_id')
			.join('url_refs as ur', 'ur.id', 'ri.url_id')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'ri.content_type_id')
			.whereNull('rre.resource_id')
			.where('ri.is_external', 0);
		if (options.urlPattern) {
			query.where('ur.url', 'like', options.urlPattern);
		}
		if (options.status != null) {
			query.where('ri.status', options.status);
		}
		if (options.contentType) {
			query.where('ctr.raw', 'like', `${options.contentType}%`);
		}
		if (options.source) {
			query.where('ri.source', options.source);
		}
		return query;
	};

	const countResult = (await baseWhere(knex('resource_items as ri')).count(
		'ri.id as total',
	)) as {
		total: number;
	}[];
	const total = countResult[0]?.total ?? 0;

	const rowQuery = baseWhere(knex('resource_items as ri')).select(
		'ur.url as url',
		'ri.status as status',
		'ctr.raw as contentType',
		'ri.content_length as contentLength',
		'ri.source as source',
	);
	applyListOrder(rowQuery, knex, sortBy, sortOrder, {
		url: { column: '"ur"."url"', type: useUrlSort ? 'url' : 'plain' },
		status: { column: '"ri"."status"' },
		contentType: { column: '"ctr"."raw"' },
		contentLength: { column: '"ri"."content_length"' },
		source: { column: '"ri"."source"' },
	});
	const rows = (await rowQuery.limit(limit).offset(offset)) as {
		url: string;
		status: number | null;
		contentType: string | null;
		contentLength: number | null;
		source: string | null;
	}[];

	const items: UnusedResourceEntry[] = rows.map((row) => ({
		url: row.url,
		status: row.status,
		contentType: row.contentType,
		contentLength: row.contentLength,
		source: (row.source ?? 'crawled') as PageSource,
	}));

	return {
		items,
		total: Number(total),
	};
}
