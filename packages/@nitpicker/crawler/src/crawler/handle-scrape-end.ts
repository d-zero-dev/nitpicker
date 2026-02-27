import type LinkList from './link-list.js';
import type { CrawlerOptions } from './types.js';
import type { AnchorData, Link, PageData } from '../utils/index.js';
import type { ExURL } from '@d-zero/shared/parse-url';

import { crawlerLog } from '../debug.js';

import { injectScopeAuth } from './inject-scope-auth.js';
import { isExternalUrl } from './is-external-url.js';
import { isInAnyLowerLayer } from './is-in-any-lower-layer.js';

/**
 * Process the result of a successful page scrape.
 *
 * Extracts anchors from the page (unless in metadata-only mode), enqueues
 * newly discovered URLs via the `addUrl` callback, and marks the URL
 * as done in the link list.
 * @param result - The scraped page data.
 * @param linkList - The link list managing the crawl queue.
 * @param scope - Map of hostnames to their scope URLs.
 * @param options - Crawler configuration options.
 * @param addUrl - Callback to enqueue a newly discovered URL. Accepts optional
 *   `{ metadataOnly: true }` to request metadata-only scraping.
 * @returns An object containing the constructed link and whether the page is external.
 */
export function handleScrapeEnd(
	result: PageData,
	linkList: LinkList,
	scope: ReadonlyMap<string, readonly ExURL[]>,
	options: CrawlerOptions,
	addUrl: (url: ExURL, opts?: { metadataOnly?: true }) => void,
): { link: Link | null; isExternal: boolean } {
	const isMetadataOnly = linkList.isMetadataOnly(result.url.withoutHash);
	if (!isMetadataOnly) {
		processAnchors(result.anchorList, scope, options, addUrl);
	}

	const link = linkList.done(
		result.url,
		scope,
		{
			page: result,
		},
		options,
	);

	crawlerLog('Scrape end URL: %s', result.url.href);
	crawlerLog('Scrape end Status: %d', result.status);
	crawlerLog('Scrape end Type: %s', result.contentType);
	if (!result.isExternal) {
		crawlerLog('Scrape end Anchors: %d URLs', result.anchorList.length);
	}

	return { link, isExternal: result.isExternal };
}

/**
 * Process anchor elements extracted from a scraped page and enqueue new URLs.
 *
 * For each anchor:
 * 1. Determines if it is external (outside the crawl scope)
 * 2. Injects authentication credentials from matching scope URLs
 * 3. Reconstructs the `withoutHash` URL with injected auth
 * 4. In recursive mode: enqueues internal lower-layer URLs for full scraping,
 *    and external URLs for metadata-only scraping (if `fetchExternal` is enabled)
 * 5. In non-recursive mode: enqueues all URLs for metadata-only scraping
 * @param anchors - The list of anchor data extracted from the page.
 * @param scope - Map of hostnames to their scope URLs.
 * @param options - Crawler configuration options.
 * @param addUrl - Callback to enqueue a newly discovered URL. Accepts optional
 *   `{ metadataOnly: true }` to request metadata-only scraping.
 */
function processAnchors(
	anchors: AnchorData[],
	scope: ReadonlyMap<string, readonly ExURL[]>,
	options: CrawlerOptions,
	addUrl: (url: ExURL, opts?: { metadataOnly?: true }) => void,
): void {
	for (const anchor of anchors) {
		const isExternal = isExternalUrl(anchor.href, scope);
		anchor.isExternal = isExternal;

		if (!isExternal && (!anchor.href.username || !anchor.href.password)) {
			injectScopeAuth(anchor.href, scope);

			const auth =
				anchor.href.username && anchor.href.password
					? `${anchor.href.username}:${anchor.href.password}@`
					: '';
			const host =
				anchor.href.hostname + (anchor.href.port ? `:${anchor.href.port}` : '');
			const newSearch = anchor.href.query ? `?${anchor.href.query}` : '';
			const body = anchor.href.dirname
				? `${anchor.href.paths.join('/')}${newSearch}`
				: newSearch
					? `${newSearch}`
					: '';
			const withoutHash = `${anchor.href.protocol}//${auth}${host}${body ? `/${body}` : ''}`;

			anchor.href.withoutHash = withoutHash;
		}

		if (options.recursive) {
			const scopes = scope.get(anchor.href.hostname);
			if (scopes && isInAnyLowerLayer(anchor.href, scopes, options)) {
				addUrl(anchor.href);
			} else if (isExternal && options.fetchExternal) {
				addUrl(anchor.href, { metadataOnly: true });
			}
			continue;
		}

		addUrl(anchor.href, { metadataOnly: true });
	}
}
