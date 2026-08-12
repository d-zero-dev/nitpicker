import type { PageData } from '../../../../utils/types/types.js';
import type {
	FlatPageMetaColumns,
	MainContentsDenormalizedColumns,
	PageDenormalizedColumns,
} from '../../../meta/types.js';
import type { PageSource } from '../../../types.js';
import type { WriteRefCaches } from '../../_shared/types.js';
import type { Knex } from 'knex';

import { normalizeContentType } from '../../../../crawler/normalize-content-type.js';
import { computeMainContentsDenormalized } from '../../../meta/compute-main-contents-denormalized.js';
import { computePageDenormalized } from '../../../meta/compute-page-denormalized.js';
import { deriveFlatFromMeta } from '../../../meta/derive-flat-from-meta.js';
import { deriveMetaExtras } from '../../../meta/derive-meta-extras.js';
import { PAGE_META_COLUMN_MAPS } from '../../../page-meta-column-maps.js';
import { upsertTextRefs } from '../../../populate-entity-tables/upsert-text-refs.js';
import { DATA_URI_URL_REFS_LIMIT } from '../../../populate-ref-tables/data-uri-url-refs-limit.js';
import { resolveContentItemId } from '../../_shared/resolve-content-item-id.js';
import { upsertContentTypeRef } from '../../_shared/upsert-content-type-ref.js';
import { upsertJsonRef } from '../../_shared/upsert-json-ref.js';
import { upsertResponseHeaders } from '../../_shared/upsert-response-headers.js';
import { upsertUrlRef } from '../../_shared/upsert-url-ref.js';

/**
 * Upserts page data into `content_items` + `page_meta` (inserts the
 * identity row if new, updates if existing).
 *
 * `source` is intentionally NOT in the UPDATE clause — provenance is set
 * once at INSERT time inside `resolveContentItemId`, and existing rows
 * keep whatever label they were first inserted with, except for the
 * priority lattice applied below: `'crawled'` > `'inventory-seed'` >
 * `'inventory-discovered'`. The inventory feature exists to surface
 * orphans (= URLs NOT reachable from the original crawl roots), so
 * anything reachable via the crawled chain must be labelled `'crawled'`
 * even if previously labelled `'inventory-*'`.
 *
 * `is_external`, by contrast, IS overwritten on every call — but demotion is
 * guarded. `updatePage` keys the row by the redirect DESTINATION url while
 * passing the REQUESTING url's `isExternal`, so the value written here
 * describes the requester, not necessarily this row. Inheriting it is
 * deliberate when PROMOTING (an out-of-scope soft-404 page reached from an
 * in-scope request counts as covered by the crawl, and the viewer relies on
 * that — see `@nitpicker/query`'s `build-directory-tree-rows.ts`). It would be
 * wrong when DEMOTING: an out-of-scope url redirecting to an in-scope page
 * that was already taken on as a target must not flip that page to
 * `is_external = 1` — no reading of the column justifies erasing a real
 * observation with an inherited one. `crawler.ts`'s `#scrapedDestinations`
 * blocks this within one run, but that is per-`#runDeal` memory, so a later
 * `--append` / `--retry-failed` process starts blind to what the DB already
 * knows — hence the CASE below, which checks the ROW's own prior state
 * instead: once `scraped = 1 AND is_external = 0` is true, no later call can
 * flip it back to `1`. Promotion (`0 → 1` before the row has been scraped, or
 * `1 → 0` at any time) is untouched. This mirrors how `first_crawled_at`'s `COALESCE` below
 * protects an established value — deliberately NOT by re-deriving scope from
 * the destination url, which would also kill the wanted promoting case.
 *
 * The page's response headers are decomposed and written into the
 * header dictionary tables here — per response, not deferred to
 * crawl-end — and the resulting `header_set_id` lands on the same
 * `content_items` UPDATE. Meta text / URL / JSON values are interned
 * into `text_refs` / `url_refs` / `json_refs` and `page_meta` stores
 * only the FK ids; on a re-scrape the `page_meta` row is fully replaced
 * (`ON CONFLICT(page_id) DO UPDATE` over every column) exactly as the
 * legacy flat-column UPDATE overwrote every column.
 * @param knex - Knex query builder connected to the archive DB. Used as the
 *   fallback when `trx` is not provided.
 * @param caches - The connection's write-side id caches.
 * @param page - The scraped page data.
 * @param isTarget - Whether this page is a crawl target.
 * @param trx - Optional transaction all statements run through.
 * @param source - Inventory provenance for the INSERT path. Ignored on UPDATE
 *   except through the priority lattice described above.
 * @returns The `content_items.id` of the inserted or updated row.
 */
export async function insertPage(
	knex: Knex,
	caches: WriteRefCaches,
	page: PageData,
	isTarget: boolean,
	trx?: Knex.Transaction,
	source?: PageSource,
): Promise<number> {
	const qb = trx ?? knex;
	const pageId = await resolveContentItemId(
		qb,
		caches,
		page.url.withoutHashAndAuth,
		undefined,
		source,
	);
	const flat = deriveFlatFromMeta(page.meta, page.url.href);
	const denorm = computePageDenormalized(page.meta);
	const mainContentsDenorm = computeMainContentsDenormalized(
		page.mainContents,
		page.scrollHeight,
	);
	const extras = deriveMetaExtras(page.meta);
	const now = Date.now();
	// Canonicalize so the stored dictionary value matches the exact-string
	// page-ness predicate (`content_type_refs.raw = 'text/html'`) used by
	// the read layer and the case-insensitive `isHtmlContentType` used in
	// code. Responses are recorded verbatim upstream, so `Text/HTML` /
	// `text/html ` can otherwise fork dictionary rows and silently
	// misclassify.
	const contentType = normalizeContentType(page.contentType);
	const contentTypeId =
		contentType == null || contentType === ''
			? null
			: await upsertContentTypeRef(qb, caches, contentType);
	const headerSetId = await upsertResponseHeaders(qb, caches, page.responseHeaders);
	// Source priority on UPDATE: 'crawled' > 'inventory-seed' >
	// 'inventory-discovered'. In current callers, `source` only arrives as
	// `'inventory-seed'` / `'inventory-discovered'` / `undefined`
	// (`derivePageSource` never emits `'crawled'`, and outside inventory
	// mode `source` is `undefined` so this CASE never runs). The
	// `? = 'crawled'` branch is therefore reachable only via a future
	// call site that wants to explicitly assert a crawled lineage —
	// today the actual crawled-wins downgrade fires in
	// `resolveContentItemId` when an anchor lineage `'crawled'` lands on
	// an existing `'inventory-*'` row. The branch is kept so the CASE
	// completely describes the priority lattice in one place.
	const sourceUpdate =
		source === undefined
			? {}
			: {
					source: qb.raw(
						`CASE
								WHEN source = 'crawled' OR ? = 'crawled' THEN 'crawled'
								WHEN source = 'inventory-seed' OR ? = 'inventory-seed' THEN 'inventory-seed'
								WHEN source = 'inventory-discovered' OR ? = 'inventory-discovered' THEN 'inventory-discovered'
								ELSE source
							END`,
						[source, source, source],
					),
				};
	await qb('content_items')
		.where('id', pageId)
		.update({
			scraped: 1,
			// Once a row has been scraped as a real crawl target, no later call
			// may flip it back off — same inheritance-from-the-requester bug as
			// `is_external` below (`setExternalPage` always passes `isTarget:
			// false`), and the same fix: guard on the row's own prior state
			// instead of per-run memory. Demoting is_target away from an
			// established value would under-count `getScrapedHtmlPageCount`'s
			// resume offset and silently break the "isTarget=1 means covered by
			// the crawl" contract `accessor.getPages('page')` documents.
			is_target: qb.raw('CASE WHEN scraped = 1 AND is_target = 1 THEN 1 ELSE ? END', [
				isTarget ? 1 : 0,
			]),
			// Once a row has been scraped as internal, no later call may flip it
			// back to external — see this function's docs for why the write this
			// guards against happens at all.
			is_external: qb.raw('CASE WHEN scraped = 1 AND is_external = 0 THEN 0 ELSE ? END', [
				page.isExternal ? 1 : 0,
			]),
			status: page.status,
			status_text: page.statusText,
			content_type_id: contentTypeId,
			content_length: page.contentLength,
			header_set_id: headerSetId,
			// Timestamps: `first_crawled_at` is set only on first scrape —
			// `COALESCE` preserves the existing value so a re-scrape
			// (`--append`, `--retry-failed`) does not erase the discovery time.
			// `last_crawled_at` is updated every successful scrape.
			first_crawled_at: qb.raw('COALESCE(first_crawled_at, ?)', [now]),
			last_crawled_at: now,
			is_skipped: page.isSkipped ? 1 : 0,
			...sourceUpdate,
		});
	// The cache's `source` mirror only tracks the resolveContentItemId
	// lattice; when the CASE above rewrites the column, refresh the cache
	// from the caller-supplied label so a later crawled-wins check sees
	// the current value. (`'crawled'` never arrives here today — see the
	// CASE comment — so the only observable effect is seed-over-discovered
	// promotion, which the lattice below reproduces.)
	if (source !== undefined) {
		const entry = caches.contentItems.get(page.url.withoutHashAndAuth);
		if (entry !== undefined && entry.source === 'inventory-discovered') {
			entry.source = source;
		}
	}
	await upsertPageMeta(
		qb,
		caches,
		pageId,
		flat,
		denorm,
		page.mainContents == null ? null : mainContentsDenorm,
		extras,
	);
	return pageId;
}

/**
 * Builds and upserts the `page_meta` row for one scraped page: interns
 * text / URL / JSON values into their ref tables, then fully replaces
 * the row (every column participates in the `DO UPDATE`) so a re-scrape
 * behaves exactly like the legacy per-column UPDATE.
 * @param qb - Knex instance or transaction.
 * @param caches - The connection's write-side id caches.
 * @param pageId - The owning `content_items.id`.
 * @param flat - Flat meta columns from `deriveFlatFromMeta`.
 * @param denorm - Denormalised aggregates from `computePageDenormalized`.
 * @param mainContentsDenorm - Denormalised `main_content_*` / `scroll_height_*`
 *   aggregates from `computeMainContentsDenormalized`, or `null` when the
 *   page's `mainContents` was `null` (degraded / non-HTML scrape). `null`
 *   here omits all seventeen columns from the upsert entirely — on
 *   `ON CONFLICT DO UPDATE` this leaves a previous full scrape's values
 *   untouched rather than overwriting them with NULL, mirroring the
 *   `page_main_content_*` child-table writers' same no-op-on-null guard.
 * @param extras - Nested-Meta catch-all from `deriveMetaExtras`.
 */
async function upsertPageMeta(
	qb: Knex | Knex.Transaction,
	caches: WriteRefCaches,
	pageId: number,
	flat: FlatPageMetaColumns,
	denorm: PageDenormalizedColumns,
	mainContentsDenorm: MainContentsDenormalizedColumns | null,
	extras: Record<string, unknown>,
): Promise<void> {
	const texts = new Set<string>();
	for (const { source } of PAGE_META_COLUMN_MAPS.text) {
		const value = flat[source];
		if (typeof value === 'string' && value !== '') {
			texts.add(value);
		}
	}
	const textIds = await upsertTextRefs(qb, texts);

	const row: Record<string, unknown> = {
		page_id: pageId,
		lang: flat.lang,
		dir: flat.dir,
		charset: flat.charset,
		base_href: flat.baseHref,
		viewport_raw: flat.viewport_raw,
		theme_color: flat.themeColor,
		application_name: flat.applicationName,
		author: flat.author,
		generator: flat.generator,
		publisher: flat.publisher,
		robots_noindex: flat.robots_noindex,
		robots_nofollow: flat.robots_nofollow,
		robots_noarchive: flat.robots_noarchive,
		robots_noimageindex: flat.robots_noimageindex,
		googlebot: flat.googlebot,
		og_type: flat.og_type,
		og_site_name: flat.og_site_name,
		og_image_alt: flat.og_image_alt,
		og_image_width: flat.og_image_width,
		og_image_height: flat.og_image_height,
		og_locale: flat.og_locale,
		og_article_published_time: flat.og_article_published_time,
		og_article_modified_time: flat.og_article_modified_time,
		twitter_card: flat.twitter_card,
		twitter_site: flat.twitter_site,
		twitter_creator: flat.twitter_creator,
		fb_app_id: flat.fb_app_id,
		verification_google: flat.verification_google,
		format_detection_telephone: flat.formatDetection_telephone,
		// Denormalised aggregates: written once at scrape time so list reads
		// (Sheets, page-detail summary) can answer "how many JSON-LD
		// entries?" and "which Wappalyzer providers?" by selecting a single
		// column rather than running a GROUP BY join on every read.
		tag_count: denorm.tag_count,
		jsonld_count: denorm.jsonld_count,
		tags_providers_csv: denorm.tags_providers_csv,
		// Omitted entirely (not set to null) when mainContentsDenorm is null —
		// see the parameter doc above for why this preserves prior values on
		// ON CONFLICT DO UPDATE instead of erasing them.
		...mainContentsDenorm,
	};
	for (const { source, target } of PAGE_META_COLUMN_MAPS.text) {
		const value = flat[source];
		row[target] =
			typeof value === 'string' && value !== '' ? (textIds.get(value) ?? null) : null;
	}
	for (const { source, target } of PAGE_META_COLUMN_MAPS.url) {
		const value = flat[source];
		if (typeof value !== 'string' || value === '' || isLargeDataUri(value)) {
			// `page_meta` has no `*_blob_id` companion columns, so a large
			// data URI in a URL slot (a base64 favicon, typically) is
			// dropped rather than ballooning `url_refs` with an opaque
			// payload — matching the archive-migration behaviour.
			row[target] = null;
			continue;
		}
		row[target] = await upsertUrlRef(qb, caches, value);
	}
	const extrasJson = JSON.stringify(extras);
	row.meta_extras_json_id =
		extrasJson === '' ? null : await upsertJsonRef(qb, caches, extrasJson);

	await qb('page_meta').insert(row).onConflict('page_id').merge();
}

/**
 * Returns `true` when `value` is a `data:` URI larger than the routing
 * threshold — the same rule that routes image `src` values to
 * `blob_refs` instead of `url_refs`.
 * @param value - Raw URL column value.
 */
function isLargeDataUri(value: string): boolean {
	return value.startsWith('data:') && value.length > DATA_URI_URL_REFS_LIMIT;
}
