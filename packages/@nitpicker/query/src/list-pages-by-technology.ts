import type { ListPagesByTechnologyOptions, PageListItem, PageListRow } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { buildHeaderPresenceSelects } from './build-header-presence-selects.js';
import { hasDedupeCapEventIdColumn } from './has-dedupe-cap-event-id-column.js';
import { isDedupeCappedSelectColumn } from './is-dedupe-capped-select-column.js';
import {
	PAGE_LIST_SELECT_COLUMNS,
	mapPageRowToListItem,
} from './map-page-row-to-list-item.js';
import { hasPageTemplatesTable, templateKeySelectColumn } from './page-templates-join.js';
import { requireConsoleErrorCountColumn } from './require-console-error-count-column.js';

/**
 * Lists pages where the given technology was detected, optionally filtered
 * by a minimum confidence and/or a specific contributing signal type.
 *
 * Direct replacement for `listPagesByTag` — joins `page_technologies`
 * (the confidence-combined roll-up) rather than the removed `page_tags`.
 * `signalType`, when given, additionally requires a matching
 * `technology_signals` row so MCP/LLM consumers can ask "pages where
 * Next.js was detected via `_next/` specifically" rather than any signal.
 * @param accessor - The archive accessor to query.
 * @param options - `technology` (required), optional `minConfidence` / `signalType` / `limit` / `offset`.
 * @returns Matching page list items, in pageId order.
 * @example
 * // Every page with Next.js detected at confidence >= 70:
 * const pages = await listPagesByTechnology(accessor, {
 *   technology: 'Next.js',
 *   minConfidence: 70,
 * });
 */
export async function listPagesByTechnology(
	accessor: ArchiveAccessor,
	options: ListPagesByTechnologyOptions,
): Promise<PageListItem[]> {
	const knex = accessor.getKnex();
	await requireConsoleErrorCountColumn(knex);
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const hasPageTemplates = await hasPageTemplatesTable(knex);
	const hasDedupeCapColumn = await hasDedupeCapEventIdColumn(knex);
	let q = knex('content_items as ci')
		.join('page_technologies as ptech', 'ptech.pageId', '=', 'ci.id')
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
		q = q.leftJoin('page_templates as pt', 'pt.page_id', 'ci.id');
	}
	q = q
		.distinct(
			...PAGE_LIST_SELECT_COLUMNS,
			templateKeySelectColumn(knex, hasPageTemplates),
			isDedupeCappedSelectColumn(knex, hasDedupeCapColumn),
			'ci.id',
			...buildHeaderPresenceSelects(knex, 'hf'),
		)
		.where('ptech.technology', options.technology)
		.where('ci.scraped', 1)
		.whereNull('ci.redirect_dest_id');
	if (options.minConfidence !== undefined) {
		q = q.where('ptech.confidence', '>=', options.minConfidence);
	}
	if (options.signalType !== undefined) {
		q = q.whereExists((subquery) =>
			subquery
				.select(1)
				.from('technology_signals as ts')
				.where('ts.pageId', '=', knex.raw('ptech.pageId'))
				.where('ts.technology', '=', knex.raw('ptech.technology'))
				.where('ts.signalType', options.signalType!),
		);
	}
	const rows = (await q
		.orderBy('ci.id', 'asc')
		.limit(limit)
		.offset(offset)) as PageListRow[];
	return rows.map(mapPageRowToListItem);
}
