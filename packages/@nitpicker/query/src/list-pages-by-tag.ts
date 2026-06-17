import type { ListPagesByTagOptions, PageListItem, PageListRow } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { mapPageRowToListItem, PAGE_LIST_COLUMNS } from './map-page-row-to-list-item.js';

/**
 * Lists pages that have a Wappalyzer-detected tag matching the given provider
 * (and optionally a specific external ID).
 *
 * Uses a single SQL pass joining `page_tags` and `pages`, hitting the
 * compound `(provider, externalId)` / `(provider, pageId)` indexes. Returns
 * the same {@link PageListItem} shape as `listPages` so callers can pipe
 * results through the same UI / display helpers.
 *
 * For very-popular providers (GTM on a 100k-page site) callers should set
 * `limit` to keep the response bounded — the count-only sibling
 * `countPagesByTag` is exposed for size-checking up front.
 * @param accessor - The archive accessor to query.
 * @param options - `provider` (required), optional `externalId`, `limit`, `offset`.
 * @returns Matching page list items, in pageId order.
 */
export async function listPagesByTag(
	accessor: ArchiveAccessor,
	options: ListPagesByTagOptions,
): Promise<PageListItem[]> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const columns = PAGE_LIST_COLUMNS.map((c) => `pages.${c}`);
	let q = knex('pages')
		.distinct(...columns, 'pages.id')
		.join('page_tags', 'page_tags.pageId', '=', 'pages.id')
		.where('page_tags.provider', options.provider)
		.where('pages.scraped', 1)
		.whereNull('pages.redirectDestId');
	if (options.externalId !== undefined) {
		q = q.where('page_tags.externalId', options.externalId);
	}
	const rows = (await q
		.orderBy('pages.id', 'asc')
		.limit(limit)
		.offset(offset)) as PageListRow[];
	return rows.map(mapPageRowToListItem);
}
