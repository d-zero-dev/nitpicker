import type { CrawlerError } from './utils/index.js';

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
}
