import type { CrawlerError, PageData } from './utils/types/types.js';

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
