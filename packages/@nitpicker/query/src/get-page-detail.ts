import type { PageDetail } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Retrieves detailed information about a single page by URL.
 * Includes all metadata, outbound links, inbound links, and redirect sources.
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
	} catch {
		// ignore parse errors
	}

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

	const inboundRows = await knex('anchors')
		.select('pages.url', 'anchors.textContent')
		.join('pages', 'anchors.pageId', '=', 'pages.id')
		.where('anchors.hrefId', page.id);

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
