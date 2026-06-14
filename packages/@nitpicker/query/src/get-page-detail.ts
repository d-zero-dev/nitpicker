import type { PageDetail } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Retrieves detailed information about a single page by URL.
 * Includes all metadata, outbound links, inbound links, and redirect sources.
 * Inbound links are resolved through redirects, so links to a redirect source
 * (e.g. `http://x` 301-ing to `https://x`) count as backlinks of the final
 * destination — they stay merged on the canonical page instead of splitting (#71).
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
		console.warn(`Failed to parse responseHeaders for ${url}:`, error);
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
	const inboundRows = await knex('anchors')
		.select('referrer.url', 'anchors.textContent')
		.join('pages as referrer', 'anchors.pageId', '=', 'referrer.id')
		.join('pages as target', 'anchors.hrefId', '=', 'target.id')
		.whereRaw('coalesce("target"."redirectDestId", "target"."id") = ?', [page.id]);

	const inboundLinks = inboundRows.map(
		(row: { url: string; textContent: string | null }) => ({
			url: row.url,
			textContent: row.textContent,
		}),
	);

	const redirectRows = await knex('pages').select('url').where('redirectDestId', page.id);

	const redirectFrom = redirectRows.map((row: { url: string }) => row.url);

	return {
		url: page.url,
		status: page.status,
		statusText: page.statusText,
		contentType: page.contentType,
		contentLength: page.contentLength,
		isExternal: !!page.isExternal,
		title: page.title,
		description: page.description,
		keywords: page.keywords,
		lang: page.lang,
		canonical: page.canonical,
		alternate: page.alternate,
		noindex: !!page.noindex,
		nofollow: !!page.nofollow,
		noarchive: !!page.noarchive,
		ogType: page.og_type,
		ogTitle: page.og_title,
		ogSiteName: page.og_site_name,
		ogDescription: page.og_description,
		ogUrl: page.og_url,
		ogImage: page.og_image,
		twitterCard: page.twitter_card,
		responseHeaders,
		outboundLinks,
		inboundLinks,
		redirectFrom,
	};
}
