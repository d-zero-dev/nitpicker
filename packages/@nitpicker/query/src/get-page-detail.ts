import type { PageDetail } from './types.js';
import type { ArchiveAccessor, JsonLdRow, TagRow } from '@nitpicker/crawler';

/**
 * Summarises JSON-LD rows for the page-detail response.
 *
 * Mirrors `archive/meta/summarize-jsonld` (crawler internal); kept here as a
 * thin local copy because the crawler does not export it.
 * @param rows
 */
function summarizeJsonLdRows(rows: readonly JsonLdRow[]): PageDetail['jsonLd'] {
	const types = new Set<string>();
	let parseErrorCount = 0;
	for (const row of rows) {
		types.add(row.type ?? '(unknown)');
		if (row.parseError !== null) parseErrorCount++;
	}
	return {
		count: rows.length,
		types: [...types].toSorted(),
		parseErrorCount,
	};
}

/**
 * Summarises tag rows for the page-detail response.
 * @param rows
 */
function summarizeTagRows(rows: readonly TagRow[]): PageDetail['tags'] {
	const providerIds: Record<string, Set<string>> = {};
	for (const row of rows) {
		if (!(row.provider in providerIds)) {
			providerIds[row.provider] = new Set<string>();
		}
		if (row.externalId !== null) {
			providerIds[row.provider]!.add(row.externalId);
		}
	}
	const sorted: Record<string, readonly string[]> = {};
	for (const provider of Object.keys(providerIds).toSorted()) {
		sorted[provider] = [...providerIds[provider]!].toSorted();
	}
	return { count: rows.length, providerIds: sorted };
}

/**
 * Retrieves detailed information about a single page by URL.
 *
 * Includes the full flat meta column set, the `meta_extras` JSON catch-all,
 * outbound links, inbound links (resolved through redirects so backlinks to
 * a redirect source stay merged on the canonical destination per #71),
 * redirect sources, and lightweight summaries of `page_jsonld` / `page_tags`.
 *
 * Raw JSON-LD entries and full tag rows are fetched via the dedicated
 * `getPageJsonLd(url)` / `getPageTags(url)` endpoints so this response stays
 * token-bounded for MCP / LLM consumers.
 * @param accessor - The archive accessor to query.
 * @param url - The URL of the page to retrieve.
 * @returns Detailed page information, or null if the page is not found.
 */
export async function getPageDetail(
	accessor: ArchiveAccessor,
	url: string,
): Promise<PageDetail | null> {
	const knex = accessor.getKnex();

	const [page] = await knex('pages').where('url', url).limit(1);
	if (!page) {
		return null;
	}

	let responseHeaders: Record<string, string> = {};
	try {
		if (page.responseHeaders) {
			responseHeaders = JSON.parse(page.responseHeaders);
		}
	} catch (error) {
		// eslint-disable-next-line no-console -- surfaces DB data-integrity issues that would otherwise fail silently
		console.warn(`Failed to parse responseHeaders for ${url}:`, error);
	}

	let metaExtras: Record<string, unknown> = {};
	try {
		if (page.meta_extras) {
			const parsed: unknown = JSON.parse(page.meta_extras);
			if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
				metaExtras = parsed as Record<string, unknown>;
			}
		}
	} catch (error) {
		// eslint-disable-next-line no-console -- surfaces DB data-integrity issues that would otherwise fail silently
		console.warn(`Failed to parse meta_extras for ${url}:`, error);
	}

	// Outbound links intentionally do NOT resolve through redirects (asymmetric
	// with inboundLinks below): they show the RAW anchor target — e.g. a link to
	// `http://x` that 301s to `https://x` is reported as pointing at `http://x`.
	// This preserves the audit signal "this page links to a redirecting URL".
	// Inbound is the opposite: it merges backlinks onto the canonical destination
	// (#71). See ARCHITECTURE.md「被リンク/参照の redirect 透過解決（#71）」.
	const outboundRows = await knex('anchors')
		.select('pages.url', 'anchors.textContent', 'pages.status', 'pages.isExternal')
		.join('pages', 'anchors.hrefId', '=', 'pages.id')
		.where('anchors.pageId', page.id);

	const outboundLinks = outboundRows.map(
		(row: {
			url: string;
			textContent: string | null;
			status: number | null;
			isExternal: 0 | 1;
		}) => ({
			url: row.url,
			textContent: row.textContent,
			status: row.status,
			isExternal: !!row.isExternal,
		}),
	);

	// Inbound links are resolved THROUGH redirects: an anchor pointing at a
	// redirect source (e.g. `http://x` 301-ing to `https://x`) is counted as an
	// incoming link to the redirect's final destination, not the source — so
	// backlinks stay merged on the canonical page instead of splitting across the
	// `http`/`https` pair (#71). `redirectDestId` is pre-flattened to the final
	// destination, so `COALESCE(target.redirectDestId, target.id)` is a single hop
	// (same semantics as crawler's `redirectTable()`).
	//
	// Grouped by referrer.id (not just selected distinct) so a referrer with
	// multiple anchors to this page still yields exactly one row — this must stay
	// in lockstep with listExternalLinks's `COUNT(DISTINCT source.id)`, otherwise
	// the External Links table's referrer count and this page's inbound-link list
	// disagree on how many pages actually link here.
	const inboundRows = (await knex('anchors')
		.select('referrer.url')
		.min('anchors.textContent as textContent')
		.join('pages as referrer', 'anchors.pageId', '=', 'referrer.id')
		.join('pages as target', 'anchors.hrefId', '=', 'target.id')
		.whereRaw('coalesce("target"."redirectDestId", "target"."id") = ?', [page.id])
		.groupBy('referrer.id', 'referrer.url')) as {
		url: string;
		textContent: string | null;
	}[];

	const inboundLinks = inboundRows.map(
		(row: { url: string; textContent: string | null }) => ({
			url: row.url,
			textContent: row.textContent,
		}),
	);

	const redirectRows = await knex('pages').select('url').where('redirectDestId', page.id);

	const redirectFrom = redirectRows.map((row: { url: string }) => row.url);

	const [jsonLdRows, tagRows] = await Promise.all([
		accessor.getJsonLdOfPage(page.id),
		accessor.getTagsOfPage(page.id),
	]);

	return {
		url: page.url,
		status: page.status,
		statusText: page.statusText,
		contentType: page.contentType,
		contentLength: page.contentLength,
		isExternal: !!page.isExternal,
		isSkipped: !!page.isSkipped,
		skipReason: page.skipReason,
		title: page.title,
		description: page.description,
		keywords: page.keywords,
		lang: page.lang,
		dir: page.dir,
		charset: page.charset,
		baseHref: page.baseHref,
		viewportRaw: page.viewport_raw,
		themeColor: page.themeColor,
		applicationName: page.applicationName,
		author: page.author,
		generator: page.generator,
		publisher: page.publisher,
		robotsRaw: page.robots_raw,
		noindex: !!page.robots_noindex,
		nofollow: !!page.robots_nofollow,
		noarchive: !!page.robots_noarchive,
		noimageindex: !!page.robots_noimageindex,
		googlebot: page.googlebot,
		canonical: page.canonical,
		amphtml: page.amphtml,
		manifest: page.manifest,
		iconHref: page.icon_href,
		appleTouchIconHref: page.appleTouchIcon_href,
		ogType: page.og_type,
		ogTitle: page.og_title,
		ogUrl: page.og_url,
		ogSiteName: page.og_site_name,
		ogDescription: page.og_description,
		ogImage: page.og_image,
		ogImageAlt: page.og_image_alt,
		ogImageWidth: page.og_image_width,
		ogImageHeight: page.og_image_height,
		ogLocale: page.og_locale,
		ogArticlePublishedTime: page.og_article_published_time,
		ogArticleModifiedTime: page.og_article_modified_time,
		twitterCard: page.twitter_card,
		twitterSite: page.twitter_site,
		twitterCreator: page.twitter_creator,
		twitterTitle: page.twitter_title,
		twitterDescription: page.twitter_description,
		twitterImage: page.twitter_image,
		fbAppId: page.fb_app_id,
		verificationGoogle: page.verification_google,
		formatDetectionTelephone:
			page.formatDetection_telephone === null
				? null
				: page.formatDetection_telephone === 1,
		firstCrawledAt: page.firstCrawledAt,
		lastCrawledAt: page.lastCrawledAt,
		tagCount: page.tag_count,
		jsonldCount: page.jsonld_count,
		tagsProvidersCsv: page.tags_providers_csv,
		metaExtras,
		jsonLd: summarizeJsonLdRows(jsonLdRows),
		tags: summarizeTagRows(tagRows),
		responseHeaders,
		outboundLinks,
		inboundLinks,
		redirectFrom,
	};
}
