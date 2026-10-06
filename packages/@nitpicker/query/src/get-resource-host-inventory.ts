import type {
	ContentTypeCategory,
	GetResourceHostInventoryOptions,
	ResourceHostEntry,
	ResourceHostInventory,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { classifyContentType } from './classify-content-type.js';
import { excludeSkippedPages } from './exclude-skipped-pages.js';

interface HostKeyRow {
	host: string;
	port: number | null;
	isExternal: 0 | 1;
}

/**
 * Stable map key for an origin row.
 * @param row - Row carrying host / port / isExternal.
 * @returns The composite key.
 */
function originKey(row: HostKeyRow): string {
	return `${row.host}\u0000${row.port ?? ''}\u0000${row.isExternal}`;
}

/**
 * Builds the resource query restricted to URL-identified resources.
 * @param knex - The archive's Knex instance.
 * @param options - Origin filter.
 * @returns A fresh query over `resource_items` joined to `url_refs`.
 */
function createResourceQuery(
	knex: Knex,
	options: GetResourceHostInventoryOptions,
): Knex.QueryBuilder {
	const query = knex('resource_items as ri')
		.join('url_refs as ur', 'ur.id', 'ri.url_id')
		.whereNotNull('ur.host');
	if (options.isExternal != null) {
		query.where('ri.is_external', options.isExternal ? 1 : 0);
	}
	return query;
}

/**
 * Aggregates sub-resources by serving origin (host + port): how many
 * distinct resources and referencing pages each host accounts for, and the
 * Content-Type category mix.
 *
 * Answers third-party dependency questions ("which external hosts does the
 * site load fonts / scripts from?") in one call instead of paging through
 * `listResources`. The category mix is classified at read time with
 * `classifyContentType` from `content_type_refs.raw`, matching the pages
 * list, rather than read from the stored `content_type_refs.category`
 * column, so rule changes apply to existing archives.
 *
 * Resources whose URL is a large `data:` URI (`url_blob_id`, no
 * `url_refs` row) have no host and are excluded.
 * @param accessor - The archive accessor to query.
 * @param options - Origin filter, sorting, and pagination.
 * @returns Hosts sorted and sliced, with the total host count.
 * @example
 * const { items } = await getResourceHostInventory(accessor, {
 *   isExternal: true,
 *   sortBy: 'pageCount',
 * });
 */
export async function getResourceHostInventory(
	accessor: ArchiveAccessor,
	options: GetResourceHostInventoryOptions = {},
): Promise<ResourceHostInventory> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const sortBy = options.sortBy ?? 'resourceCount';
	const order = options.sortOrder ?? (sortBy === 'host' ? 'asc' : 'desc');

	const typeRows = (await createResourceQuery(knex, options)
		.leftJoin('content_type_refs as ctr', 'ctr.id', 'ri.content_type_id')
		.groupBy('ur.host', 'ur.port', 'ri.is_external', 'ctr.raw')
		.select(
			'ur.host as host',
			'ur.port as port',
			'ri.is_external as isExternal',
			'ctr.raw as contentType',
			knex.raw('count(*) as "count"'),
		)) as (HostKeyRow & { contentType: string | null; count: number | string })[];

	const pageRows = (await createResourceQuery(knex, options)
		.join('resource_ref_edges as rre', 'rre.resource_id', 'ri.id')
		.join('content_items as ci', 'ci.id', 'rre.page_id')
		.where((qb) => excludeSkippedPages(qb, 'ci.is_skipped'))
		.groupBy('ur.host', 'ur.port', 'ri.is_external')
		.select(
			'ur.host as host',
			'ur.port as port',
			'ri.is_external as isExternal',
			knex.raw('count(distinct "rre"."page_id") as "pageCount"'),
		)) as (HostKeyRow & { pageCount: number | string })[];
	const pageCountByOrigin = new Map(
		pageRows.map((row) => [originKey(row), Number(row.pageCount)]),
	);

	const entries = new Map<string, ResourceHostEntry>();
	for (const row of typeRows) {
		const key = originKey(row);
		let entry = entries.get(key);
		if (!entry) {
			entry = {
				host: row.host,
				port: row.port,
				isExternal: !!row.isExternal,
				resourceCount: 0,
				pageCount: pageCountByOrigin.get(key) ?? 0,
				categories: {},
			};
			entries.set(key, entry);
		}
		const count = Number(row.count);
		const category: ContentTypeCategory = classifyContentType(row.contentType);
		entry.resourceCount += count;
		entry.categories[category] = (entry.categories[category] ?? 0) + count;
	}

	const sorted = [...entries.values()].toSorted((a, b) => {
		const diff =
			sortBy === 'host'
				? (a.host < b.host ? -1 : a.host > b.host ? 1 : 0) ||
					(a.port ?? 0) - (b.port ?? 0)
				: a[sortBy] - b[sortBy];
		return order === 'asc' ? diff : -diff;
	});

	return {
		items: sorted.slice(offset, offset + limit),
		total: sorted.length,
		offset,
		limit,
	};
}
