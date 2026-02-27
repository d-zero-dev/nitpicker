import type { Link, PageData } from '../utils/index.js';
import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';

import { isError } from '@d-zero/beholder';
import { isLowerLayer } from '@d-zero/shared/is-lower-layer';
import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import { protocolAgnosticKey } from './protocol-agnostic-key.js';

/**
 * Manages the queue of URLs discovered during crawling.
 *
 * Tracks URLs across three states: pending (queued but not started),
 * in-progress (currently being scraped), and done (scraping completed).
 * Provides deduplication based on `withoutHashAndAuth` normalization
 * and tracks page completion counts for progress reporting.
 */
export default class LinkList {
	#completePages = 0;
	#done = new Set<string>();
	#metadataOnlyFlag = new Set<string>();
	#pending = new Set<string>();
	#predictedFlag = new Set<string>();
	#progress = new Set<string>();

	/**
	 * The number of successfully completed internal HTML pages.
	 *
	 * Only counts pages that are internal, in a lower layer, use HTTP(S),
	 * have no error status, and have `text/html` content type.
	 */
	get completePages() {
		return this.#completePages;
	}

	/**
	 * Add a URL to the pending queue if it has not been seen before.
	 *
	 * Deduplication is based on the URL's `withoutHashAndAuth` representation.
	 * If the URL is already pending, in progress, or done, this is a no-op.
	 * @param linkUrl - The parsed URL to add to the queue.
	 * @param options - Optional flags for the URL.
	 * @param options.metadataOnly - If `true`, marks this URL for title-only scraping
	 *   (metadata extraction without full page processing).
	 * @param options.predicted - If `true`, marks this URL as a predicted pagination guess
	 *   that should be discarded if it returns a 4xx/5xx status.
	 */
	add(linkUrl: ExURL, options?: { metadataOnly?: true; predicted?: true }) {
		const key = protocolAgnosticKey(linkUrl.withoutHashAndAuth);
		if (this.#pending.has(key) || this.#progress.has(key) || this.#done.has(key)) {
			return;
		}
		this.#pending.add(key);
		if (options?.metadataOnly) {
			this.#metadataOnlyFlag.add(key);
		}
		if (options?.predicted) {
			this.#predictedFlag.add(key);
		}
	}

	/**
	 * Mark a URL as completed and record its scrape result.
	 *
	 * Moves the URL from pending/progress to done, constructs a {@link Link}
	 * object with scope and layer information, and increments the page counter
	 * if the result qualifies as a valid HTML page.
	 * @param url - The URL that has been scraped.
	 * @param scope - The current scope map (hostname to scope URLs).
	 * @param resource - The scrape result containing page data and/or error information.
	 * @param resource.page - The scraped page data, if the scrape succeeded.
	 * @param resource.error - The error object, if the scrape failed.
	 * @param options - URL parsing options (e.g., `disableQueries`).
	 * @returns The constructed {@link Link} object, or `null` if the URL was not in the queue.
	 */
	done(
		url: ExURL,
		scope: ReadonlyMap<string /* hostname */, readonly ExURL[]>,
		resource: { page?: PageData; error?: Error },
		options: ParseURLOptions,
	): Link | null {
		const key = protocolAgnosticKey(url.withoutHashAndAuth);
		if (!(this.#pending.has(key) || this.#progress.has(key))) {
			return null;
		}
		this.#pending.delete(key);
		this.#progress.delete(key);
		const linkUrl = parseUrl(url, options);
		if (!linkUrl) {
			return null;
		}
		const sameScopes = scope.get(linkUrl.hostname);
		const link: Link = {
			url: linkUrl,
			isLowerLayer: sameScopes
				? sameScopes.some((s) => isLowerLayer(linkUrl.href, s.href, options))
				: false,
			isExternal: !sameScopes,
		};
		const urlList = new Set<string>([key]);
		if (resource.page) {
			link.dest = {
				redirectPaths: resource.page.redirectPaths,
				status: resource.page.status,
				statusText: resource.page.statusText,
				contentType: resource.page.contentType,
				contentLength: resource.page.contentLength,
				responseHeaders: resource.page.responseHeaders,
				title: resource.page.meta.title,
			};

			for (const path of resource.page.redirectPaths) {
				urlList.add(protocolAgnosticKey(path));
			}
		}
		if (resource.error?.message.includes('ERR_NAME_NOT_RESOLVED')) {
			link.dest = {
				redirectPaths: [],
				status: -1,
				statusText: resource.error.message,
				contentType: null,
				contentLength: null,
				responseHeaders: {},
			};
		}
		const isPageLink = isPage(link);
		for (const passedUrl of urlList) {
			this.#done.add(passedUrl);
			if (isPageLink) {
				this.#completePages += 1;
			}
		}
		return link;
	}

	/**
	 * Get the current pending and in-progress URL lists.
	 * @returns An object containing arrays of pending and in-progress URL strings.
	 */
	getLinks() {
		return {
			/** URLs queued but not yet started. */
			pending: [...this.#pending.values()],
			/** URLs currently being scraped. */
			progress: [...this.#progress.values()],
		};
	}

	/**
	 * Get a summary of crawl progress counts.
	 * @returns An object with total/completed counts for both all links and pages only.
	 */
	getPageCount() {
		const { pending, progress } = this.getLinks();
		const pendingPages = pending;
		const progressPages = progress;
		const totalLinks = pending.length + progress.length + this.#done.size;
		const completedLinks = this.#done.size;
		const totalPages = pendingPages.length + progressPages.length + this.#completePages;
		const completedPages = this.#completePages;

		return {
			/** Total number of discovered links (pending + progress + done). */
			totalLinks,
			/** Number of links that have been fully processed. */
			completedLinks,
			/** Total number of discovered pages (pending + progress + completed pages). */
			totalPages,
			/** Number of pages that have been successfully scraped. */
			completedPages,
		};
	}

	/**
	 * Check whether a URL is flagged for title-only scraping.
	 *
	 * Title-only scraping extracts only the page title and basic metadata,
	 * without processing anchors or capturing the full HTML.
	 * @param urlWithoutHashAndAuth - The normalized URL string (without hash and auth) to check.
	 * @returns `true` if the URL should be scraped in title-only mode.
	 */
	isMetadataOnly(urlWithoutHashAndAuth: string) {
		return this.#metadataOnlyFlag.has(protocolAgnosticKey(urlWithoutHashAndAuth));
	}
	/**
	 * Check whether a URL was added as a predicted pagination URL.
	 * @param urlWithoutHashAndAuth - The normalized URL string (without hash and auth) to check.
	 * @returns `true` if the URL was added with the predicted flag.
	 */
	isPredicted(urlWithoutHashAndAuth: string) {
		return this.#predictedFlag.has(protocolAgnosticKey(urlWithoutHashAndAuth));
	}

	/**
	 * Transition a URL from the pending state to the in-progress state.
	 *
	 * This should be called when scraping of the URL actually begins.
	 * If the URL is not in the pending set, this is a no-op.
	 * @param url - The URL that is now being actively scraped.
	 */
	progress(url: ExURL) {
		const key = protocolAgnosticKey(url.withoutHashAndAuth);
		if (!this.#pending.has(key)) {
			return;
		}
		this.#pending.delete(key);
		this.#progress.add(key);
	}

	/**
	 * Restore the link list state from a previous crawl session.
	 *
	 * Re-adds pending URLs to the queue and marks previously done URLs
	 * as completed, enabling the crawler to resume from where it left off.
	 * @param pending - URLs that were pending in the previous session.
	 * @param done - URLs that were already completed in the previous session.
	 * @param options - URL parsing options for re-parsing the pending URLs.
	 * @returns The parsed pending URLs that were successfully added to the queue.
	 */
	resume(pending: string[], done: string[], options: ParseURLOptions): ExURL[] {
		const parsedPending: ExURL[] = [];
		for (const url of done) {
			this.#done.add(protocolAgnosticKey(url));
		}
		for (const url of pending) {
			const parsedUrl = parseUrl(url, options);
			if (!parsedUrl) {
				continue;
			}
			this.add(parsedUrl);
			parsedPending.push(parsedUrl);
		}
		return parsedPending;
	}
}

/**
 * Determine whether a link represents a valid internal HTML page.
 *
 * A link qualifies as a "page" if it is:
 * - Internal (not external)
 * - In a lower layer of the scope
 * - Using HTTP or HTTPS protocol
 * - Has destination data with a non-error status
 * - Has `text/html` content type
 * @param link - The link to evaluate.
 * @returns `true` if the link represents a valid internal HTML page.
 */
function isPage(link: Link) {
	if (link.isExternal) {
		return false;
	}

	if (!link.isLowerLayer) {
		return false;
	}

	if (!/^https?:$/.test(link.url.protocol)) {
		return false;
	}

	if (!link.dest) {
		return false;
	}

	if (isError(link.dest.status)) {
		return false;
	}

	if (link.dest.contentType === 'text/html') {
		return true;
	}

	return false;
}
