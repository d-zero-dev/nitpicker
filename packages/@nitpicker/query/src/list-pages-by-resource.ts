import type { ListPagesByResourceOptions, PagesByResourceResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/archive/archive-accessor';
import type { Knex } from 'knex';

import { applyCategoryFilter } from './content-type-rules.js';
import { excludeSkippedPages } from './exclude-skipped-pages.js';
import { SQLITE_IN_CHUNK } from './sqlite-in-chunk.js';

/**
 * Builds the page ← resource edge query with every resource filter applied.
 * @param knex - The archive's Knex instance.
 * @param options - Resource filters.
 * @returns A fresh query joining pages to their matching resources.
 */
function createEdgeQuery(
	knex: Knex,
	options: ListPagesByResourceOptions,
): Knex.QueryBuilder {
	const query = knex('resource_ref_edges as rre')
		.join('resource_items as ri', 'ri.id', 'rre.resource_id')
		.join('content_items as ci', 'ci.id', 'rre.page_id')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.leftJoin('url_refs as rur', 'rur.id', 'ri.url_id')
		.leftJoin('content_type_refs as ctr', 'ctr.id', 'ri.content_type_id')
		.where((qb) => excludeSkippedPages(qb, 'ci.is_skipped'));
	if (options.urlPattern) {
		query.where('rur.url', 'like', options.urlPattern);
	}
	if (options.contentTypeCategory) {
		applyCategoryFilter(query, options.contentTypeCategory);
	}
	if (options.isExternal != null) {
		query.where('ri.is_external', options.isExternal ? 1 : 0);
	}
	if (options.status != null) {
		query.where('ri.status', options.status);
	}
	return query;
}

/**
 * Lists the pages that load at least one resource matching a URL pattern
 * and/or Content-Type category — the reverse lookup of `listResources`.
 *
 * Answers questions such as "which pages load a web font", "which pages
 * pull anything from `fonts.example.net`" or "which pages include
 * `jquery*.js`" from `resource_ref_edges` alone. Resource bodies are not
 * stored in the archive, so this works on resource URLs and MIME types
 * (what the browser actually fetched), not on CSS/JS contents.
 *
 * Each page carries a bounded sample of its matching resource URLs
 * (`resourcesLimit`) so a gallery page does not blow up the response.
 * @param accessor - The archive accessor to query.
 * @param options - Resource filters (at least one of `urlPattern` /
 *   `contentTypeCategory`) and pagination.
 * @returns Pages ordered by page id, with match counts and sample URLs.
 * @throws {Error} If neither `urlPattern` nor `contentTypeCategory` is given.
 * @example
 * const { items } = await listPagesByResource(accessor, {
 *   contentTypeCategory: 'font',
 *   urlPattern: '%SampleSans%',
 * });
 */
export async function listPagesByResource(
	accessor: ArchiveAccessor,
	options: ListPagesByResourceOptions,
): Promise<PagesByResourceResult> {
	if (!options.urlPattern && !options.contentTypeCategory) {
		throw new Error(
			'At least one of urlPattern or contentTypeCategory is required to list pages by resource.',
		);
	}
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const resourcesLimit = options.resourcesLimit ?? 20;

	const [totalRow] = await createEdgeQuery(knex, options).countDistinct<
		{ count: number | string }[]
	>({ count: 'rre.page_id' });
	const total = Number(totalRow?.count ?? 0);

	const pages = (await createEdgeQuery(knex, options)
		.groupBy('rre.page_id', 'ur.url')
		.orderBy('rre.page_id')
		.limit(limit)
		.offset(offset)
		.select(
			'rre.page_id as pageId',
			'ur.url as url',
			knex.raw('count(distinct "rre"."resource_id") as "matchedResourceCount"'),
		)) as { pageId: number; url: string; matchedResourceCount: number | string }[];

	const sampleByPageId = new Map<number, string[]>();
	for (let i = 0; i < pages.length; i += SQLITE_IN_CHUNK) {
		const ids = pages.slice(i, i + SQLITE_IN_CHUNK).map((page) => page.pageId);
		const ranked = createEdgeQuery(knex, options)
			.whereIn('rre.page_id', ids)
			.select(
				'rre.page_id as pageId',
				'rur.url as resourceUrl',
				knex.raw(
					'row_number() over (partition by "rre"."page_id" order by "rur"."url") as "rn"',
				),
			)
			.as('ranked');
		const rows = (await knex
			.from(ranked)
			.where('rn', '<=', resourcesLimit)
			.orderBy([{ column: 'pageId' }, { column: 'rn' }])
			.select('pageId', 'resourceUrl')) as {
			pageId: number;
			resourceUrl: string | null;
		}[];
		for (const row of rows) {
			if (row.resourceUrl == null) {
				continue;
			}
			const sample = sampleByPageId.get(row.pageId) ?? [];
			sample.push(row.resourceUrl);
			sampleByPageId.set(row.pageId, sample);
		}
	}

	return {
		items: pages.map((page) => ({
			url: page.url,
			matchedResourceCount: Number(page.matchedResourceCount),
			matchedResources: sampleByPageId.get(page.pageId) ?? [],
		})),
		total,
		offset,
		limit,
	};
}
