import type LinkList from './link-list.js';
import type { CrawlerOptions } from './types.js';
import type { Link, PageData } from '../utils/index.js';
import type { ExURL } from '@d-zero/shared/parse-url';

import { crawlerErrorLog } from '../debug.js';

import { linkToPageData } from './link-to-page-data.js';

/**
 * Handle an error that occurred during page scraping.
 *
 * Marks the URL as done and creates a fallback {@link PageData} from the
 * link, regardless of whether the error caused a shutdown. This ensures
 * that errored URLs are recorded in the DB (`status = -1, scraped = 1`)
 * and not re-queued on resume.
 * @param payload - The error payload from the scraper.
 * @param payload.url - The URL being scraped when the error occurred, or `null`.
 * @param payload.error - The error details including name, message, and optional stack.
 * @param payload.error.name
 * @param payload.error.message
 * @param payload.error.stack
 * @param payload.shutdown - Whether the error caused the scraper process to shut down.
 * @param payload.pid - The process ID of the scraper, or `undefined`.
 * @param linkList - The link list managing the crawl queue.
 * @param scope - Map of hostnames to their scope URLs.
 * @param options - Crawler configuration options.
 * @returns An object with the link and an optional fallback PageData result.
 */
export function handleScrapeError(
	payload: {
		url: ExURL | null;
		error: { name: string; message: string; stack?: string };
		shutdown: boolean;
		pid: number | undefined;
	},
	linkList: LinkList,
	scope: ReadonlyMap<string, readonly ExURL[]>,
	options: CrawlerOptions,
): { link: Link | null; result?: PageData } {
	const { url, error, shutdown, pid } = payload;
	let link: Link | null = null;
	let result: PageData | undefined;

	if (url) {
		const updated = linkList.done(url, scope, { error }, options);
		if (updated) {
			link = updated;
			result = linkToPageData(updated);
		}
	}

	crawlerErrorLog('From %d(%s)', pid, url?.href ?? 'UNKNOWN_URL');
	crawlerErrorLog('Then shutdown?: %s', shutdown ? 'Yes' : 'No');
	crawlerErrorLog('%O', error);

	return { link, result };
}
