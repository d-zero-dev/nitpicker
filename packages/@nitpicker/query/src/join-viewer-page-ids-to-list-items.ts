import type { PageListItem, PageListRow } from './types.js';
import type { Knex } from 'knex';

import { buildHeaderPresenceSelects } from './build-header-presence-selects.js';
import {
	PAGE_LIST_SELECT_COLUMNS,
	mapPageRowToListItem,
} from './map-page-row-to-list-item.js';
import { hasPageTemplatesTable, templateKeySelectColumn } from './page-templates-join.js';

/**
 * Joins an already ID-limited, already-ordered `page_id` list back to the
 * 0.13 write-model entity graph (`content_items` + `page_meta` + refs)
 * for full-metadata display.
 *
 * The `IN (...)` fetch does not preserve `pageIds`' order (SQLite gives no
 * such guarantee), so the result is re-sorted in JS by `pageIds`' order
 * afterward — cheap, since this only ever runs over a `limit`-bounded page.
 * @param knex - The archive's Knex instance.
 * @param pageIds - The page IDs to fetch.
 * @returns The corresponding {@link PageListItem} rows, in `pageIds` order.
 */
export async function joinViewerPageIdsToListItems(
	knex: Knex,
	pageIds: number[],
): Promise<PageListItem[]> {
	if (pageIds.length === 0) {
		return [];
	}
	const hasPageTemplates = await hasPageTemplatesTable(knex);
	let query = knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
		.leftJoin('page_meta as pm', 'pm.page_id', 'ci.id')
		.leftJoin('header_flags as hf', 'hf.header_set_id', 'ci.header_set_id')
		.leftJoin('text_refs as title_ref', 'title_ref.id', 'pm.title_text_id')
		.leftJoin(
			'text_refs as description_ref',
			'description_ref.id',
			'pm.description_text_id',
		)
		.leftJoin('text_refs as keywords_ref', 'keywords_ref.id', 'pm.keywords_text_id')
		.leftJoin('text_refs as robots_raw_ref', 'robots_raw_ref.id', 'pm.robots_raw_text_id')
		.leftJoin('text_refs as og_title_ref', 'og_title_ref.id', 'pm.og_title_text_id')
		.leftJoin(
			'text_refs as og_description_ref',
			'og_description_ref.id',
			'pm.og_description_text_id',
		)
		.leftJoin('url_refs as canonical_ur', 'canonical_ur.id', 'pm.canonical_url_id')
		.leftJoin('url_refs as og_url_ur', 'og_url_ur.id', 'pm.og_url_id')
		.leftJoin('url_refs as og_image_ur', 'og_image_ur.id', 'pm.og_image_url_id')
		.leftJoin(
			'url_refs as twitter_image_ur',
			'twitter_image_ur.id',
			'pm.twitter_image_url_id',
		)
		.leftJoin('url_refs as manifest_ur', 'manifest_ur.id', 'pm.manifest_url_id');
	if (hasPageTemplates) {
		query = query.leftJoin('page_templates as pt', 'pt.page_id', 'ci.id');
	}
	const rows: (PageListRow & { id: number })[] = await query
		.whereIn('ci.id', pageIds)
		.select(
			'ci.id as id',
			...PAGE_LIST_SELECT_COLUMNS,
			templateKeySelectColumn(knex, hasPageTemplates),
			...buildHeaderPresenceSelects(knex, 'hf'),
		);
	const rowsById = new Map(rows.map((row) => [row.id, row]));
	return pageIds
		.map((id) => rowsById.get(id))
		.filter((row): row is PageListRow & { id: number } => row != null)
		.map((row) => mapPageRowToListItem(row));
}
