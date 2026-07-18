import type { PageDataWithDomPaths, PageSource } from '../../../types.js';
import type { WriteRefCaches } from '../../_shared/types.js';
import type { ExURL } from '@d-zero/shared/parse-url';
import type { Knex } from 'knex';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import { isHtmlContentType } from '../../../../crawler/is-html-content-type.js';
import { eachSplitted } from '../../../../utils/array/each-splitted.js';
import { dbLog } from '../../../debug.js';
import { deriveLineageFromParent } from '../../../derive-lineage-from-parent.js';
import { matchImagesToDomPaths } from '../../../populate-entity-tables/match-images-to-dom-paths.js';
import { upsertTextRefs } from '../../../populate-entity-tables/upsert-text-refs.js';
import { resolveRedirectChain } from '../../../resolve-redirect-chain.js';
import { clearWriteRefCaches } from '../../_shared/clear-write-ref-caches.js';
import { resolveContentItemId } from '../../_shared/resolve-content-item-id.js';
import { resolveUrlOrBlob } from '../../_shared/resolve-url-or-blob.js';

import { insertJsonLd } from './insert-jsonld.js';
import { insertPage } from './insert-page.js';
import { insertTags } from './insert-tags.js';
import { linkRedirectSources } from './link-redirect-sources.js';
import { writePageHtmlBlob } from './write-page-html-blob.js';

/**
 * Inserts or updates a crawled page — `content_items` + `page_meta` plus its
 * redirect chain, `anchor_edges`, `image_items`, and (when `writeHtml`) its
 * compressed HTML snapshot BLOB.
 *
 * Self-redirects (where the source URL equals the destination URL after
 * normalization) are skipped to avoid marking a page as redirected to itself
 * — a situation caused by authentication challenges (e.g. Basic Auth 302)
 * that would otherwise exclude the page from reports via the
 * `whereNull('redirect_dest_id')` filter.
 * @param knex - Knex query builder connected to the archive DB.
 * @param caches - The connection's write-side id caches.
 * @param page - The page data to store, optionally carrying the in-browser
 *   dom-path capture (see {@link PageDataWithDomPaths}).
 * @param writeHtml - When `true`, this call is allowed to insert (or clear)
 *   the page's HTML blob. `setExternalPage` passes `false` because external
 *   metadata-only scrapes never carry HTML and must not perturb an already
 *   stored body.
 * @param isTarget - Whether this page is a crawl target.
 * @param source - Provenance label written ONLY when the row is freshly
 *   inserted. Existing rows keep their original `source` (this is why a
 *   second `crawl --inventory` does not "demote" an `'inventory-seed'` row
 *   that was discovered earlier).
 * @returns The database `pageId` (`content_items.id`) of the inserted or updated row.
 */
export async function updatePage(
	knex: Knex,
	caches: WriteRefCaches,
	page: PageDataWithDomPaths,
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

	try {
		return await knex.transaction(async (trx) => {
			return await updatePageInTransaction(
				trx,
				knex,
				caches,
				page,
				destUrlObject,
				sources,
				writeHtml,
				isTarget,
				source,
			);
		});
	} catch (error) {
		// A rolled-back transaction can leave ids cached that no longer
		// correspond to any row (AUTOINCREMENT never rewinds) — see
		// `clearWriteRefCaches` for why a full clear, not a partial one,
		// is required. `emitErrorAndRetry` may retry this whole call, so
		// the cache must be clean before the next attempt.
		clearWriteRefCaches(caches);
		throw error;
	}
}

/**
 * The transactional body of {@link updatePage}, extracted so the
 * transaction boundary in the caller can wrap it in a try/catch for
 * cache invalidation on rollback.
 * @param trx - The active transaction.
 * @param knex - Knex query builder connected to the archive DB (passed
 *   through to `insertPage` for its `trx ?? knex` fallback contract).
 * @param caches - The connection's write-side id caches.
 * @param page - The page data to store.
 * @param destUrlObject - The parsed redirect-chain destination URL.
 * @param sources - Redirect-source URLs from the chain resolution.
 * @param writeHtml - See {@link updatePage}.
 * @param isTarget - See {@link updatePage}.
 * @param source - See {@link updatePage}.
 * @returns The `content_items.id` of the inserted or updated row.
 */
async function updatePageInTransaction(
	trx: Knex.Transaction,
	knex: Knex,
	caches: WriteRefCaches,
	page: PageDataWithDomPaths,
	destUrlObject: ExURL,
	sources: readonly string[],
	writeHtml: boolean,
	isTarget: boolean,
	source: PageSource | undefined,
): Promise<number> {
	const pageId = await insertPage(
		knex,
		caches,
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
	// rationale in `recordRedirect`: intermediates are reached
	// transitively from the originating URL's render, so they
	// inherit its lineage. The `source` argument is the
	// authoritative origin label when inventoryMode is live; fall
	// through to a DB lookup of `page.url` for the resume /
	// retry-failed path where the call-site has no source.
	let originatingSource: PageSource | undefined = source;
	if (originatingSource === undefined) {
		originatingSource = await readSourceByUrl(trx, caches, page.url.withoutHashAndAuth);
	}
	const chainLineageSource = deriveLineageFromParent(originatingSource, 'crawled');
	await linkRedirectSources(
		trx,
		caches,
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
		// `page_html_ref` never contradicts the content type. A degraded HTML
		// re-scrape (text/html or unknown content type with empty html) is NOT
		// cleared — the last good snapshot is preserved, mirroring the
		// anchors / images empty-guard below. Gated on `writeHtml` because a
		// stale ref can only have been written by a snapshot-capable call
		// (`setPage`); `setExternalPage` passes `writeHtml = false` and never
		// sets `html`, so it has nothing to clear.
		await trx('page_html_ref').where('page_id', pageId).delete();
	}
	// Re-scrape semantics: the same URL can be scraped more than once
	// (e.g. `crawl --resume`, re-visits, `--append` re-promotion). Edges
	// are replaced wholesale per page on every non-empty scrape — the
	// delete is paired with, and guarded by, a non-empty new list: a
	// degraded re-scrape (navigation timeout / partial render) can return
	// an empty `anchorList` for a page that previously had links, and
	// wiping the prior good data in that case would be destructive. We
	// cannot tell a transient empty result apart from a page that has
	// legitimately lost all its links, so we err on the side of keeping
	// what we already had. The accepted trade-off is that a page which
	// genuinely dropped to zero links keeps its stale rows until the next
	// non-empty re-scrape replaces them (#70).
	//
	// Lineage propagation: read the current page's merged source
	// (post-UPDATE by `insertPage`) so anchor placeholder rows inherit a
	// label that reflects the parent's chain. A `'crawled'`-lineage
	// parent passes `'crawled'` explicitly so the crawled-wins downgrade
	// in `resolveContentItemId` fires when an anchor hits an existing
	// `'inventory-*'` row. An inventory-lineage parent passes
	// `'inventory-discovered'` to label transitively-reached URLs
	// correctly without the orchestrator needing to rehydrate
	// `inventoryMode` from disk.
	const [parentRow] = (await trx
		.select('source')
		.from('content_items')
		.where('id', pageId)) as { source: PageSource }[];
	const anchorLineageSource = deriveLineageFromParent(parentRow?.source, 'crawled');
	await replaceAnchorEdges(trx, caches, pageId, page, anchorLineageSource);
	await replaceImageItems(trx, caches, pageId, page);
	// Clear this page's resource_ref_edges unconditionally (no non-empty
	// guard, unlike anchors/images above): the crawler always emits this
	// page's `responseReferrers` events right after its `page` event (see
	// `Crawler#handleResources`, called immediately after `#handleResult`
	// for the same scrape), through the same serialized WriteQueue, so the
	// fresh INSERT is guaranteed to follow this DELETE in commit order —
	// no writer can interleave a stale re-insert between them. This is a
	// write-ordering guarantee only: the DELETE and the follow-up INSERT
	// are still two separate transactions, so a concurrent read-only
	// connection (viewer / MCP open on the same archive during an active
	// `--append` / `--retry-failed` run) can observe a momentary window
	// with zero rows for this page and misclassify its resources as
	// unused. The window closes as soon as the next transaction commits,
	// so this is a transient display artifact, not a durable data loss —
	// accepted rather than merging the two writes into one transaction.
	// A degraded re-scrape that legitimately captures zero sub-resources
	// leaves this page referrer-less until its next non-empty re-scrape —
	// accepted, since resource_items rows for no-longer-referenced
	// resources are themselves allowed to become orphaned (no cross-page
	// cleanup is attempted for those either).
	await trx('resource_ref_edges').where('page_id', pageId).delete();
	return pageId;
}

/**
 * Reads the `source` of the row identified by `url` without creating a
 * placeholder — the cache-first mirror of the legacy by-URL SELECT.
 * Returns `undefined` when no row exists yet.
 * @param trx - The active transaction.
 * @param caches - The connection's write-side id caches (read-only here;
 *   a DB fallback does not populate the identity cache because the id is
 *   not needed).
 * @param url - Normalised URL key.
 */
async function readSourceByUrl(
	trx: Knex.Transaction,
	caches: WriteRefCaches,
	url: string,
): Promise<PageSource | undefined> {
	const cached = caches.contentItems.get(url);
	if (cached !== undefined) {
		return cached.source;
	}
	const [row] = (await trx
		.select('ci.source')
		.from('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.where('ur.url', url)) as { source: PageSource }[];
	return row?.source;
}

/**
 * Replaces the page's `anchor_edges` rows with the aggregate of the new
 * scrape's `anchorList` (empty-guarded; see the caller's re-scrape
 * comment). Instances sharing the same resolved `href_page_id` collapse
 * into one edge whose `count` is the instance count and whose
 * `first_hash` / `first_text_id` capture the first instance encountered
 * in list order — the same first-wins rule the archive migration applies
 * to legacy `anchors` rows.
 * @param trx - The active transaction.
 * @param caches - The connection's write-side id caches.
 * @param pageId - The owning `content_items.id`.
 * @param page - The scraped page payload.
 * @param anchorLineageSource - Lineage label for anchor-target
 *   placeholder rows (see the caller's lineage comment).
 */
async function replaceAnchorEdges(
	trx: Knex.Transaction,
	caches: WriteRefCaches,
	pageId: number,
	page: PageDataWithDomPaths,
	anchorLineageSource: PageSource | undefined,
): Promise<void> {
	if (page.anchorList.length === 0) {
		return;
	}
	interface EdgeInProgress {
		count: number;
		firstHash: string | null;
		firstText: string | null;
	}
	const edges = new Map<number, EdgeInProgress>();
	for (const anchor of page.anchorList) {
		const hrefId = await resolveContentItemId(
			trx,
			caches,
			anchor.href.withoutHashAndAuth,
			anchor.isExternal ? 1 : 0,
			anchorLineageSource,
		);
		const existing = edges.get(hrefId);
		if (existing !== undefined) {
			existing.count += 1;
			continue;
		}
		edges.set(hrefId, {
			count: 1,
			firstHash: anchor.href.hash || null,
			firstText: anchor.textContent || null,
		});
	}
	const texts = new Set<string>();
	for (const edge of edges.values()) {
		if (edge.firstText !== null) {
			texts.add(edge.firstText);
		}
	}
	const textIds = await upsertTextRefs(trx, texts);
	dbLog(
		'Replace anchor_edges: %d edges (%d instances)',
		edges.size,
		page.anchorList.length,
	);
	await trx('anchor_edges').where('page_id', pageId).delete();
	const rows = [...edges.entries()].map(([hrefPageId, edge]) => ({
		page_id: pageId,
		href_page_id: hrefPageId,
		count: edge.count,
		first_hash: edge.firstHash,
		first_text_id: edge.firstText === null ? null : (textIds.get(edge.firstText) ?? null),
	}));
	await eachSplitted(rows, 100, async (chunk) => {
		await trx('anchor_edges').insert(chunk);
	});
}

/**
 * Replaces the page's `image_items` rows with the new scrape's
 * `imageList` (empty-guarded; see the caller's re-scrape comment).
 * `src` / `currentSrc` route to `url_refs` or (for large `data:` URIs)
 * `blob_refs`; `dom_path_text_id` resolves by matching each image's
 * `sourceCode` against the in-browser capture carried on
 * `page.imageDomPaths`, falling back to the synthetic `unknown/<n>`
 * marker per image when the capture is absent or ambiguous.
 * @param trx - The active transaction.
 * @param caches - The connection's write-side id caches.
 * @param pageId - The owning `content_items.id`.
 * @param page - The scraped page payload.
 */
async function replaceImageItems(
	trx: Knex.Transaction,
	caches: WriteRefCaches,
	pageId: number,
	page: PageDataWithDomPaths,
): Promise<void> {
	if (page.imageList.length === 0) {
		return;
	}
	// Match by list index: ids only need to be unique within this call and
	// ordered in insertion order, which the list order is by construction.
	const domPaths = matchImagesToDomPaths(
		page.imageList.map((image, index) => ({
			id: index,
			sourceCode: image.sourceCode || null,
		})),
		page.imageDomPaths ?? [],
	);

	const texts = new Set<string>();
	for (const image of page.imageList) {
		if (typeof image.alt === 'string' && image.alt !== '') {
			texts.add(image.alt);
		}
	}
	for (const entry of domPaths.values()) {
		texts.add(entry.path);
	}
	const textIds = await upsertTextRefs(trx, texts);

	const rows: Record<string, unknown>[] = [];
	for (const [index, image] of page.imageList.entries()) {
		const domPath = domPaths.get(index);
		if (domPath === undefined) {
			throw new Error(`replaceImageItems: dom_path not resolved for image #${index}`);
		}
		const domPathId = textIds.get(domPath.path);
		if (domPathId === undefined) {
			throw new Error(
				`replaceImageItems: text_refs.id not resolved for dom_path=${domPath.path}`,
			);
		}
		const srcSlot = await resolveUrlOrBlob(trx, caches, image.src);
		const currentSrcSlot = await resolveUrlOrBlob(trx, caches, image.currentSrc);
		rows.push({
			page_id: pageId,
			src_url_id: srcSlot.url,
			current_src_url_id: currentSrcSlot.url,
			src_blob_id: srcSlot.blob,
			current_src_blob_id: currentSrcSlot.blob,
			alt_text_id:
				typeof image.alt === 'string' && image.alt !== ''
					? (textIds.get(image.alt) ?? null)
					: null,
			width: image.width,
			height: image.height,
			natural_width: image.naturalWidth,
			natural_height: image.naturalHeight,
			is_lazy: image.isLazy == null ? null : image.isLazy ? 1 : 0,
			viewport_width: image.viewportWidth,
			dom_path_text_id: domPathId,
		});
	}
	dbLog('Replace image_items: %d rows', rows.length);
	await trx('image_items').where('page_id', pageId).delete();
	await eachSplitted(rows, 100, async (chunk) => {
		await trx('image_items').insert(chunk);
	});
}
