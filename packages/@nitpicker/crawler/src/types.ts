import type { CrawlerError, PageData } from './utils/types/types.js';

/**
 * Coarse cause of a crawl/scrape failure.
 *
 * The crawler stores only the raw error message (in `crawl_errors`,
 * `page_errors`, or `error.log`); the cause is derived on read by
 * `classifyErrorKind`, so existing archives gain classification without a
 * re-crawl. `timeout` is a puppeteer/page-level timeout (e.g. navigation or the
 * scraper's overall race), whereas `connection-timeout` is a transport-level
 * `ETIMEDOUT`; keeping them apart lets a slow-but-reachable host be told from an
 * unreachable one.
 *
 * Owned by the crawler package because both the crawler (for DNS-burned host
 * caching) and `@nitpicker/query` (for `getErrorKinds` / `getSummary`) need to
 * classify error messages, and crawler cannot depend on query.
 */
export type ErrorKind =
	| 'dns'
	| 'connection-refused'
	| 'connection-reset'
	| 'connection-timeout'
	| 'tls'
	| 'timeout'
	| 'protocol'
	| 'unknown';

/**
 * Event map for the `CrawlerOrchestrator` class.
 *
 * Each key represents an event name and its value is the payload type
 * passed to listeners subscribed via `on()` or `once()`.
 */
export interface CrawlEvent {
	/**
	 * Emitted when the archive file write operation begins.
	 */
	writeFileStart: {
		/** Absolute path of the archive file being written. */
		filePath: string;
	};

	/**
	 * Emitted when the archive file write operation completes.
	 */
	writeFileEnd: {
		/** Absolute path of the archive file that was written. */
		filePath: string;
	};

	/**
	 * Emitted when an error occurs during crawling or archiving.
	 */
	error: CrawlerError;

	/**
	 * Emitted when a URL redirects to a destination already rendered during this
	 * crawl, so only the redirect edge is recorded and the destination is not
	 * re-rendered (#73). Mirrors the crawler's `redirect` event; useful for
	 * observing how much redirect-convergence work was skipped.
	 */
	redirect: {
		/** HEAD-resolved page data carrying the redirect chain (source → destination). */
		result: PageData;
	};
}
