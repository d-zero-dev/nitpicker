import type { ExURL } from '@d-zero/shared/parse-url';

// beholder is the canonical owner of scraping types — re-export
export type {
	PageData,
	ImageElement,
	SkippedPageData,
	Resource,
	AnchorData,
	Meta,
	NetworkLog,
} from '@d-zero/beholder';

export type { ExURL } from '@d-zero/shared/parse-url';
export type { CompressType } from '@d-zero/shared/detect-compress';
export type { CDNType } from '@d-zero/shared/detect-cdn';

/**
 * Represents a discovered link during crawling, with its metadata from the HEAD request.
 */
export interface Link {
	/** The parsed URL of the link. */
	url: ExURL;

	/** Whether this link points to an external domain. */
	isExternal: boolean;

	/** Whether this link is in a lower layer (subdirectory) of a scope URL. */
	isLowerLayer: boolean;

	/** Destination data from the HEAD request, present only if the link was fetched. */
	dest?: {
		/** Chain of redirect URLs traversed. */
		redirectPaths: string[];
		/** HTTP status code of the final response. */
		status: number;
		/** HTTP status text of the final response. */
		statusText: string;
		/** The Content-Type header value, or `null` if unavailable. */
		contentType: string | null;
		/** The Content-Length header value in bytes, or `null` if unavailable. */
		contentLength: number | null;
		/** Raw HTTP response headers, or `null` if unavailable. */
		responseHeaders: Record<string, string | string[] | undefined> | null;
		/** The page title, if available from a title-only scrape. */
		title?: string;
	};
}

/**
 * An error event emitted during crawling or scraping.
 */
export interface CrawlerError {
	/** The process ID where the error occurred. */
	pid: number;

	/** Whether the error occurred in the main process (as opposed to a sub-process). */
	isMainProcess: boolean;

	/** The URL being processed when the error occurred, or `null` if not applicable. */
	url: string | null;

	/** The error object. */
	error: Error;
}
