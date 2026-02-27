import type LinkList from './link-list.js';
import type { CrawlerOptions } from './types.js';
import type { Link } from '../utils/index.js';
import type { ExURL } from '@d-zero/shared/parse-url';

import { crawlerLog } from '../debug.js';

/**
 * Handle a URL that was ignored or skipped during scraping.
 *
 * Marks the URL as done in the link list without any page data,
 * effectively recording that it was encountered but not scraped.
 * @param url - The URL that was skipped.
 * @param linkList - The link list managing the crawl queue.
 * @param scope - Map of hostnames to their scope URLs.
 * @param options - Crawler configuration options.
 * @returns The constructed {@link Link} object, or `null` if the URL was not in the queue.
 */
export function handleIgnoreAndSkip(
	url: ExURL,
	linkList: LinkList,
	scope: ReadonlyMap<string, readonly ExURL[]>,
	options: CrawlerOptions,
): Link | null {
	const updated = linkList.done(url, scope, {}, options);
	if (updated) {
		crawlerLog('Skipped URL: %s', url.href);
	}
	return updated;
}
