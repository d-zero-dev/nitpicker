import type { PageData } from '../../../../utils/types/types.js';
import type { DB_Page, PageSource } from '../../../types.js';
import type { Knex } from 'knex';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import { isHtmlContentType } from '../../../../crawler/is-html-content-type.js';
import { eachSplitted } from '../../../../utils/array/each-splitted.js';
import { dbLog } from '../../../debug.js';
import { deriveLineageFromParent } from '../../../derive-lineage-from-parent.js';
import { resolveRedirectChain } from '../../../resolve-redirect-chain.js';
import { getIdByUrl } from '../../_shared/get-id-by-url.js';

import { insertJsonLd } from './insert-jsonld.js';
import { insertPage } from './insert-page.js';
import { insertTags } from './insert-tags.js';
import { linkRedirectSources } from './link-redirect-sources.js';
import { writePageHtmlBlob } from './write-page-html-blob.js';

/**
 * Inserts or updates a crawled page in the database, including its redirect chain,
 * anchors, images, and (when `writeHtml`) its compressed HTML snapshot BLOB.
 *
 * Self-redirects (where the source URL equals the destination URL after normalization)
 * are skipped to avoid marking a page as redirected to itself — a situation caused by
 * authentication challenges (e.g. Basic Auth 302) that would otherwise exclude the page
 * from reports via the `whereNull('redirectDestId')` filter.
 * @param knex - Knex query builder connected to the archive DB.
 * @param page - The page data to store.
 * @param writeHtml - When `true`, this call is allowed to insert (or clear)
 *   the page's HTML blob. `setExternalPage` passes `false` because external
 *   metadata-only scrapes never carry HTML and must not perturb an already
 *   stored body.
 * @param isTarget - Whether this page is a crawl target.
 * @param source - Provenance label written ONLY when the row is freshly
 *   inserted. Existing rows keep their original `source` (this is why a
 *   second `crawl --inventory` does not "demote" an `'inventory-seed'` row
 *   that was discovered earlier).
 * @returns The database `pageId` of the inserted/updated row.
 */
export async function updatePage(
	knex: Knex,
	page: PageData,
	writeHtml: boolean,
	isTarget: boolean,
	source?: PageSource,
): Promise<number> {
	const { destUrl, sources } = resolveRedirectChain(
		page.url.withoutHashAndAuth,
		page.redirectPaths,
	);

	const destUrlObject = parseUrl(destUrl);

	if (!destUrlObject) {
		throw new Error(`Failed to parse URL: ${destUrl}`);
	}

	return await knex.transaction(async (trx) => {
		const pageId = await insertPage(
			knex,
			{
				...page,
				url: destUrlObject,
			},
			isTarget,
			trx,
			source,
		);

		// Wappalyzer tag detection is HTML-body independent (relies on
		// `<script src>` / `<iframe src>` / window globals / response
		// headers) so it runs for every page including external /
		// metadata-only. JSON-LD on the other hand lives inside the
		// rendered HTML body, so we only write it when there is HTML to
		// scrape — see the same `writeHtml` gate as `writePageHtmlBlob`
		// below.
		await insertTags(pageId, page.meta, trx);
		if (writeHtml) {
			await insertJsonLd(pageId, page.meta, trx);
		}

		// Chain lineage propagates FROM the originating URL
		// (`page.url`), NOT from the destination. See the matching
		// rationale in `recordRedirect` above: intermediates are
		// reached transitively from the originating URL's render,
		// so they inherit its lineage. The `source` argument is the
		// authoritative origin label when inventoryMode is live;
		// fall through to a DB lookup of `page.url` for the resume
		// / retry-failed path where the call-site has no source.
		let originatingSource: PageSource | undefined = source;
		if (originatingSource === undefined) {
			const [originatingRow] = await trx
				.select('source')
				.from<DB_Page>('pages')
				.where('url', page.url.withoutHashAndAuth);
			originatingSource = originatingRow?.source;
		}
		const chainLineageSource = deriveLineageFromParent(originatingSource, 'crawled');
		await linkRedirectSources(
			trx,
			sources,
			pageId,
			destUrlObject.withoutHashAndAuth,
			page.isExternal,
			chainLineageSource,
		);
		// Only insert a snapshot blob when there is actual HTML to write.
		// `page.html.length > 0` is the precise signal: the scraper returns
		// `html: ''` for everything that is not a rendered `text/html` document
		// (non-HTML responses, metadata-only, external, degraded renders), so a
		// non-empty `html` is exactly "a rendered HTML body exists". Gating on
		// `isTarget` alone would store an empty body for every internal non-HTML
		// resource — PDF / zip / images are isTarget=1 (#72).
		//
		// `isTarget` is intentionally NOT part of this condition: it is implied by
		// `html.length > 0` (only in-scope target pages are browser-rendered into a
		// non-empty body; metadata-only and external pages carry `html: ''`), so the
		// content check alone expresses the intent without a redundant term.
		if (writeHtml && page.html.length > 0) {
			await writePageHtmlBlob(pageId, page.html, trx);
		} else if (
			writeHtml &&
			page.contentType !== null &&
			!isHtmlContentType(page.contentType)
		) {
			// The page is now a *known* non-HTML type. If a previous scrape stored
			// an HTML body for this URL (e.g. it served HTML then was replaced by
			// a PDF across `crawl --resume` / `--append`), drop the stale ref so
			// `page_html_ref` never contradicts `contentType`. A degraded HTML
			// re-scrape (text/html or unknown content type with empty html) is NOT
			// cleared — the last good snapshot is preserved, mirroring the
			// anchors / images empty-guard below. Gated on `writeHtml` because a
			// stale ref can only have been written by a snapshot-capable call
			// (`setPage`); `setExternalPage` passes `writeHtml = false` and never
			// sets `html`, so it has nothing to clear.
			await trx('page_html_ref').where('page_id', pageId).delete();
		}
		// Re-scrape semantics: the same URL can be scraped more than once
		// (e.g. `crawl --resume`, re-visits, `--append` re-promotion). The
		// `anchors` / `images` tables have no uniqueness constraint, so
		// re-inserting without clearing would accumulate a full duplicate set
		// on every re-scrape (#70). So we delete-then-insert
		// to *replace* the previous rows.
		//
		// The delete is paired with — and guarded by — a non-empty new list:
		// a degraded re-scrape (navigation timeout / partial render) can return
		// an empty `anchorList` for a page that previously had links, and
		// wiping the prior good data in that case would be destructive. We
		// cannot tell a transient empty result apart from a page that has
		// legitimately lost all its links, so we err on the side of keeping
		// what we already had. The accepted trade-off is that a page which
		// genuinely dropped to zero links keeps its stale rows until the next
		// non-empty re-scrape replaces them.
		//
		// (A DB-level unique constraint + `onConflict` would also prevent
		// duplication, but multiple distinct anchors can share the same
		// hrefId/hash/textContent legitimately, so there is no natural unique
		// key to enforce — replace-on-write is the correct mechanism here.)
		// Lineage propagation: read the current page's merged source
		// (post-UPDATE by `insertPage`) so anchor placeholder rows
		// inherit a label that reflects the parent's chain. A
		// `'crawled'`-lineage parent passes `'crawled'` explicitly so the
		// crawled-wins downgrade in `getIdByUrl` fires when an anchor
		// hits an existing `'inventory-*'` row. An inventory-lineage
		// parent passes `'inventory-discovered'` to label transitively-
		// reached URLs correctly without the orchestrator needing to
		// rehydrate `inventoryMode` from disk.
		//
		// Cost: one extra SELECT on `pages` per scraped page (the
		// `id` is a PK index lookup so it is sub-millisecond even at
		// 1M-row scale). The alternative — passing `mergedSource`
		// through from the UPDATE result — would require RETURNING
		// support that knex's SQLite dialect handles inconsistently;
		// the small per-page round-trip is the cheaper trade.
		const [parentRow] = await trx
			.select('source')
			.from<DB_Page>('pages')
			.where('id', pageId);
		// `deriveLineageFromParent` collapses the three call sites
		// (anchor / redirect intermediate × updatePage / recordRedirect)
		// onto the same rule. `'crawled'` fallback (vs `undefined`)
		// arms the crawled-wins downgrade in `getIdByUrl` for
		// existing `'inventory-*'` rows reached from a crawled
		// parent — see `isInventorySource` for the membership rule.
		const anchorLineageSource = deriveLineageFromParent(parentRow?.source, 'crawled');
		const anchors = await Promise.all(
			page.anchorList.map(async (anchor) => {
				const hrefId = await getIdByUrl(
					trx,
					anchor.href.withoutHashAndAuth,
					anchor.isExternal ? 1 : 0,
					anchorLineageSource,
				);
				return {
					pageId,
					hrefId,
					hash: anchor.href.hash,
					textContent: anchor.textContent,
				};
			}),
		);
		dbLog('Insert anchors.length: %d', anchors.length);
		if (anchors.length > 0) {
			await trx('anchors').where('pageId', pageId).delete();
			await eachSplitted(anchors, 100, async (_anchors) => {
				await trx('anchors').insert(_anchors);
			});
		}
		const images = page.imageList.map((image) => ({
			pageId,
			...image,
		}));
		dbLog('Insert images.length: %d', images.length);
		if (images.length > 0) {
			await trx('images').where('pageId', pageId).delete();
			await eachSplitted(images, 100, async (_images) => {
				await trx('images').insert(_images);
			});
		}
		return pageId;
	});
}
