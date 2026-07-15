import type { DB_Anchor, DB_Page, DB_Redirect, DB_Referrer } from '../../../types.js';
import type { Knex } from 'knex';

import { dbLog } from '../../../debug.js';
import { limitedPageIds } from '../../../limited-page-ids.js';
import { redirectTable } from '../../../redirect-table.js';
import { addOrderField } from '../order/add-order-field.js';
import { setUrlOrder } from '../order/set-url-order.js';

/**
 * Retrieves pages along with their related redirect, anchor, and referrer
 * data. Results are ordered by the natural URL sort order (materialised
 * through {@link addOrderField} + {@link setUrlOrder} before the join
 * queries run). Only non-redirected pages are returned in the top-level
 * `pages` array; redirect sources are surfaced only through the
 * `redirects` array so downstream reports (Sheets export) can attribute
 * every source without double-counting the destination.
 *
 * **Cross-domain call.** This is the only op that reaches from
 * `pages/read/` into `pages/order/` — `addOrderField` and `setUrlOrder`
 * are pre-flight side effects required to make `orderByRaw('order ASC
 * NULLS LAST')` produce the natural sort. Keep the two calls in
 * lock-step; skipping either yields un-sorted or partially-sorted
 * output.
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
	await addOrderField(knex);
	await setUrlOrder(knex);
	dbLog('Get Pages');
	const pages = await knex
		.select('*')
		.from<DB_Page>('pages')
		.orderByRaw('`order` ASC NULLS LAST')
		.whereNull('redirectDestId')
		.limit(limit)
		.offset(offset);

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
			'href.url',
			'redirect.from as href',
			'href.isExternal',
			'href.title',
			'href.status',
			'href.statusText',
			'href.contentType',
			'anchors.hash',
			'anchors.textContent',
		)
		.from('anchors')
		// Filters
		.join('limitedPages', 'anchors.pageId', '=', 'limitedPages.id')
		// Resolves redirect
		.join('redirect', 'anchors.hrefId', '=', 'redirect.fromId')
		// Target
		.join('pages as href', 'redirect.toId', '=', 'href.id')
		// Sort
		.orderBy('anchors.id', 'asc');

	dbLog('Get Pages: Referrers');
	const referrers: DB_Referrer[] = await knex
		.with('limitedPages', limitedPageIds(limit, offset))
		.with('redirect', redirectTable())
		.select(
			'redirect.toId as pageId',
			'referrer.url',
			'redirect.from as through',
			'redirect.fromId as throughId',
			'anchors.hash',
			'anchors.textContent',
		)
		.from('anchors')
		// Resolves redirect
		.join('redirect', 'anchors.hrefId', '=', 'redirect.fromId')
		// Referrer
		.join('pages as referrer', 'anchors.pageId', '=', 'referrer.id')
		// Filters
		.join('limitedPages', 'redirect.toId', '=', 'limitedPages.id')
		// Sort
		.orderBy('anchors.id', 'asc');

	dbLog('Get Pages: Done');
	return {
		pages,
		redirects,
		anchors,
		referrers,
	};
}
