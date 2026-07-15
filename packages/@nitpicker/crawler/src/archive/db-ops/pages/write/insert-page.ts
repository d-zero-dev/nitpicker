import type { PageData } from '../../../../utils/types/types.js';
import type { PageSource } from '../../../types.js';
import type { Knex } from 'knex';

import { normalizeContentType } from '../../../../crawler/normalize-content-type.js';
import { computePageDenormalized } from '../../../meta/compute-page-denormalized.js';
import { deriveFlatFromMeta } from '../../../meta/derive-flat-from-meta.js';
import { deriveMetaExtras } from '../../../meta/derive-meta-extras.js';
import { getIdByUrl } from '../../_shared/get-id-by-url.js';

/**
 * Upserts page data into the `pages` table (inserts if new, updates if existing).
 *
 * `source` is intentionally NOT in the UPDATE clause — provenance is set
 * once at INSERT time inside `getIdByUrl`, and existing rows keep
 * whatever label they were first inserted with.
 * @param knex - Knex query builder connected to the archive DB. Used as the
 *   fallback when `trx` is not provided.
 * @param page
 * @param isTarget
 * @param trx
 * @param source - Inventory provenance for the INSERT path. Ignored on UPDATE.
 */
export async function insertPage(
	knex: Knex,
	page: PageData,
	isTarget: boolean,
	trx?: Knex.Transaction,
	source?: PageSource,
): Promise<number> {
	const qb = trx ?? knex;
	const pageId = await getIdByUrl(qb, page.url.withoutHashAndAuth, undefined, source);
	const flat = deriveFlatFromMeta(page.meta, page.url.href);
	const denorm = computePageDenormalized(page.meta);
	const extras = deriveMetaExtras(page.meta);
	const now = Date.now();
	// Source priority on UPDATE: 'crawled' > 'inventory-seed' >
	// 'inventory-discovered'. The inventory feature exists to surface
	// orphans (= URLs NOT reachable from the original crawl roots).
	// Anything reachable via the crawled chain is therefore NOT an
	// orphan and must be labelled `'crawled'`, even if previously
	// labelled `'inventory-*'`. Within the inventory variants, the
	// explicit user-listed `'inventory-seed'` wins over the transitive
	// `'inventory-discovered'`.
	//
	// Note: in current callers, `source` only arrives as
	// `'inventory-seed'` / `'inventory-discovered'` / `undefined`
	// (`derivePageSource` never emits `'crawled'`, and outside inventory
	// mode `source` is `undefined` so this CASE never runs). The
	// `? = 'crawled'` branch is therefore reachable only via a future
	// call site that wants to explicitly assert a crawled lineage —
	// today the actual crawled-wins downgrade fires in `getIdByUrl`'s
	// SELECT path when an anchor lineage `'crawled'` lands on an
	// existing `'inventory-*'` row. The branch is kept so the CASE
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
	await qb('pages')
		.where('id', pageId)
		.update({
			scraped: true,
			isTarget,
			isExternal: page.isExternal,
			status: page.status,
			statusText: page.statusText,
			// Canonicalize so the stored value matches the exact-string page-ness
			// predicate (`WHERE contentType = 'text/html'`) used by the read layer
			// and the case-insensitive `isHtmlContentType` used in code. Responses
			// are recorded verbatim upstream, so `Text/HTML` / `text/html ` can
			// otherwise be stored and silently misclassified.
			contentType: normalizeContentType(page.contentType),
			contentLength: page.contentLength,
			responseHeaders: JSON.stringify(page.responseHeaders),
			// Flat meta columns derived from beholder 3.0.0 nested Meta.
			// URL-shaped columns (canonical / og_url / og_image / amphtml / manifest /
			// icon_href / appleTouchIcon_href / twitter_image) are already absolutised
			// by `deriveFlatFromMeta` against the page URL — `find-mismatches` compares
			// `canonical != url` directly, so storing the raw `getAttribute('href')`
			// would generate false positives for sites using relative canonicals.
			...flat,
			// Denormalised aggregates: written once at scrape time so list reads
			// (Sheets, page-detail summary) can answer "how many JSON-LD entries?"
			// and "which Wappalyzer providers?" by selecting a single pages column
			// rather than running a GROUP BY join on every read.
			tag_count: denorm.tag_count,
			jsonld_count: denorm.jsonld_count,
			tags_providers_csv: denorm.tags_providers_csv,
			// JSON catch-all for nested Meta sub-objects not flattened above.
			meta_extras: JSON.stringify(extras),
			// Timestamps: `firstCrawledAt` is set only on first INSERT — `COALESCE`
			// preserves the existing value so a re-scrape (`--append`, `--retry-failed`)
			// does not erase the discovery time. `lastCrawledAt` is updated every
			// successful scrape.
			firstCrawledAt: qb.raw('COALESCE(firstCrawledAt, ?)', [now]),
			lastCrawledAt: now,
			isSkipped: page.isSkipped,
			...sourceUpdate,
		});
	return pageId;
}
