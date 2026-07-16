import type { DB_Anchor, DB_Page, DB_Redirect, DB_Referrer } from '../../../types.js';
import type { Knex } from 'knex';

import { dbLog } from '../../../debug.js';
import { limitedPageIds } from '../../../limited-page-ids.js';
import { redirectTable } from '../../../redirect-table.js';
import { setUrlOrder } from '../order/set-url-order.js';

import { buildPageQuery } from './build-page-query.js';
import { reconstructPageRows } from './reconstruct-page-rows.js';

/**
 * Retrieves pages along with their related redirect, anchor, and referrer
 * data. Results are ordered by the natural URL sort order (materialised
 * through {@link setUrlOrder} into `content_items.crawl_order` before the
 * join queries run). Only non-redirected pages are returned in the
 * top-level `pages` array; redirect sources are surfaced only through the
 * `redirects` array so downstream reports (Sheets export) can attribute
 * every source without double-counting the destination.
 *
 * **Redirect resolution stays a read-time join.** `anchor_edges.href_page_id`
 * (like the legacy `anchors.hrefId` it replaces) is resolved by URL only at
 * write time (`resolveContentItemId`), with no redirect-chain following —
 * an anchor's target may itself become a redirect source discovered later
 * in the crawl. `redirectTable()` resolves the chain at read time so
 * `anchors[].url` reflects the final destination while `anchors[].href`
 * keeps the immediate (pre-redirect) target URL.
 *
 * **Deduped anchor identity.** `anchor_edges` collapses repeated
 * `(page_id, href_page_id)` instances into one row with a `count`; `hash` /
 * `textContent` below come from `first_hash` / `first_text_id` (the first
 * observed instance), not every instance — an intentional behavior change
 * from the legacy `anchors` table's one-row-per-instance model.
 * @param knex - Knex query builder connected to the archive DB.
 * @param offset - The number of rows to skip.
 * @param limit - The maximum number of pages to return.
 * @returns An object containing `pages`, `redirects`, `anchors`, and
 *   `referrers` arrays.
 */
export async function getPagesWithRels(
	knex: Knex,
	offset: number,
	limit: number,
): Promise<{
	pages: DB_Page[];
	redirects: DB_Redirect[];
	anchors: DB_Anchor[];
	referrers: DB_Referrer[];
}> {
	await setUrlOrder(knex);
	dbLog('Get Pages');
	const rawRows = await buildPageQuery(knex)
		.whereNull('ci.redirect_dest_id')
		.orderByRaw('`ci`.`crawl_order` ASC NULLS LAST')
		.limit(limit)
		.offset(offset);
	const pages = await reconstructPageRows(knex, rawRows);

	// When empty
	if (pages.length === 0) {
		return {
			pages: [],
			redirects: [],
			referrers: [],
			anchors: [],
		};
	}

	dbLog('Get Pages: Redirects');
	const redirects: DB_Redirect[] = await knex
		.with('limitedPages', limitedPageIds(limit, offset))
		.with('redirect', redirectTable(false))
		.select('id as pageId', 'from', 'fromId')
		.from('redirect')
		// Filter
		.join('limitedPages', 'redirect.toId', '=', 'limitedPages.id')
		// Sort
		.orderBy('id', 'asc');

	dbLog('Get Pages: Anchors');
	const anchors: DB_Anchor[] = await knex
		.with('limitedPages', limitedPageIds(limit, offset))
		.with('redirect', redirectTable())
		.select(
			'limitedPages.id as pageId',
			'href_url.url as url',
			'redirect.from as href',
			'href.is_external as isExternal',
			'href_title.text as title',
			'href.status as status',
			'href.status_text as statusText',
			'href_ctr.raw as contentType',
			'anchor_edges.first_hash as hash',
			'anchor_text.text as textContent',
		)
		.from('anchor_edges')
		// Filters
		.join('limitedPages', 'anchor_edges.page_id', '=', 'limitedPages.id')
		// Resolves redirect
		.join('redirect', 'anchor_edges.href_page_id', '=', 'redirect.fromId')
		// Target
		.join('content_items as href', 'redirect.toId', '=', 'href.id')
		.join('url_refs as href_url', 'href.url_id', '=', 'href_url.id')
		.leftJoin('content_type_refs as href_ctr', 'href.content_type_id', '=', 'href_ctr.id')
		.leftJoin('page_meta as href_pm', 'href.id', '=', 'href_pm.page_id')
		.leftJoin('text_refs as href_title', 'href_pm.title_text_id', '=', 'href_title.id')
		.leftJoin(
			'text_refs as anchor_text',
			'anchor_edges.first_text_id',
			'=',
			'anchor_text.id',
		)
		// Sort
		.orderBy('anchor_edges.id', 'asc');

	dbLog('Get Pages: Referrers');
	const referrers: DB_Referrer[] = await knex
		.with('limitedPages', limitedPageIds(limit, offset))
		.with('redirect', redirectTable())
		.select(
			'redirect.toId as pageId',
			'referrer_url.url as url',
			'redirect.from as through',
			'redirect.fromId as throughId',
			'anchor_edges.first_hash as hash',
			'anchor_text.text as textContent',
		)
		.from('anchor_edges')
		// Resolves redirect
		.join('redirect', 'anchor_edges.href_page_id', '=', 'redirect.fromId')
		// Referrer
		.join('content_items as referrer', 'anchor_edges.page_id', '=', 'referrer.id')
		.join('url_refs as referrer_url', 'referrer.url_id', '=', 'referrer_url.id')
		// Filters
		.join('limitedPages', 'redirect.toId', '=', 'limitedPages.id')
		.leftJoin(
			'text_refs as anchor_text',
			'anchor_edges.first_text_id',
			'=',
			'anchor_text.id',
		)
		// Sort
		.orderBy('anchor_edges.id', 'asc');

	dbLog('Get Pages: Done');
	return {
		pages,
		redirects,
		anchors,
		referrers,
	};
}
