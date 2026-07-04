import type { ListPagesByJsonLdTypeOptions, PageListItem, PageListRow } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { buildHeaderPresenceSelects } from './build-header-presence-selects.js';
import { mapPageRowToListItem, PAGE_LIST_COLUMNS } from './map-page-row-to-list-item.js';

/**
 * Lists pages that have at least one JSON-LD (or SpeculationRules) entry with
 * the given top-level `@type`.
 *
 * Uses a single SQL pass joining `page_jsonld(type, pageId)` to `pages`. A
 * page may have multiple matching entries (e.g. several Product schemas);
 * `DISTINCT pages.id` collapses them to one row per page.
 *
 * For popular types (`Product` on an e-commerce site) callers should set
 * `limit` to keep the response bounded — the count-only sibling
 * `countPagesByJsonLdType` is exposed for size-checking up front.
 * @param accessor - The archive accessor to query.
 * @param options - `type` (required), `limit`, `offset`.
 * @returns Matching page list items, in pageId order.
 */
export async function listPagesByJsonLdType(
	accessor: ArchiveAccessor,
	options: ListPagesByJsonLdTypeOptions,
): Promise<PageListItem[]> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const columns = PAGE_LIST_COLUMNS.map((c) => `pages.${c}`);
	const rows = (await knex('pages')
		.distinct(...columns, 'pages.id', ...buildHeaderPresenceSelects(knex))
		.join('page_jsonld', 'page_jsonld.pageId', '=', 'pages.id')
		.where('page_jsonld.type', options.type)
		.where('pages.scraped', 1)
		.whereNull('pages.redirectDestId')
		.orderBy('pages.id', 'asc')
		.limit(limit)
		.offset(offset)) as PageListRow[];
	return rows.map(mapPageRowToListItem);
}
