import type { ListPagesByJsonLdTypeOptions, PageListItem, PageListRow } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { buildHeaderPresenceSelects } from './build-header-presence-selects.js';
import {
	PAGE_LIST_SELECT_COLUMNS,
	mapPageRowToListItem,
} from './map-page-row-to-list-item.js';

/**
 * Lists pages that have at least one JSON-LD (or SpeculationRules) entry with
 * the given top-level `@type`.
 *
 * 0.13: reads through the 0.13 `content_items` + `page_meta`
 * + refs layout via {@link PAGE_LIST_SELECT_COLUMNS}. `page_jsonld` FKs
 * still reference the page id, which `content_items` preserves verbatim.
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
	const rows = (await knex('content_items as ci')
		.join('page_jsonld', 'page_jsonld.pageId', '=', 'ci.id')
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
		.leftJoin('url_refs as manifest_ur', 'manifest_ur.id', 'pm.manifest_url_id')
		.distinct(
			...PAGE_LIST_SELECT_COLUMNS,
			'ci.id',
			...buildHeaderPresenceSelects(knex, 'hf'),
		)
		.where('page_jsonld.type', options.type)
		.where('ci.scraped', 1)
		.whereNull('ci.redirect_dest_id')
		.orderBy('ci.id', 'asc')
		.limit(limit)
		.offset(offset)) as PageListRow[];
	return rows.map(mapPageRowToListItem);
}
