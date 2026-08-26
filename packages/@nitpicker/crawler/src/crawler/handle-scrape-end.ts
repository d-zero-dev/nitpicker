import type LinkList from './link-list.js';
import type { CrawlerOptions } from './types.js';
import type { AnchorData, Link, PageData } from '../utils/types/types.js';
import type { ExURL } from '@d-zero/shared/parse-url';

import { crawlerLog } from '../debug.js';

import { findScopeEntry } from './find-scope-entry.js';
import { injectScopeAuth } from './inject-scope-auth.js';

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
 * 1. Resolves the matching scope entry via a single {@link findScopeEntry} call.
 *    If `null`, the anchor is external; otherwise it is internal under the
 *    deepest matching scope.
 * 2. For internal anchors without credentials, inherits auth from the matched
 *    scope and rebuilds `withoutHash` with the injected auth.
 * 3. External anchors are skipped entirely when `fetchExternal` is off — this
 *    gate applies in both recursive and non-recursive mode.
 * 4. In recursive mode: enqueues internal anchors for full scraping, and
 *    external anchors (when not skipped by 3) for metadata-only scraping.
 * 5. In non-recursive mode: enqueues every anchor that survives gate 3 for
 *    metadata-only scraping, internal or not.
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
		const matchedScope = findScopeEntry(anchor.href, scope, options);
		const isExternal = matchedScope === null;
		anchor.isExternal = isExternal;

		if (matchedScope && (!anchor.href.username || !anchor.href.password)) {
			injectScopeAuth(anchor.href, matchedScope);

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

		// `fetchExternal` gates external anchors the same way in both modes —
		// checked once, ahead of the recursive/non-recursive split below,
		// rather than only inside the recursive branch. Non-recursive
		// discovery has no other point that enforces `fetchExternal`: every
		// anchor that reaches the split falls straight into the unconditional
		// metadata-only `addUrl` call, so scoping the check to the recursive
		// branch alone would make `--list` / `--single` / `--no-recursive`
		// unable to honour `--no-fetch-external` at all.
		if (!matchedScope && !options.fetchExternal) {
			continue;
		}

		if (options.recursive && matchedScope) {
			addUrl(anchor.href);
			continue;
		}

		addUrl(anchor.href, { metadataOnly: true });
	}
}
