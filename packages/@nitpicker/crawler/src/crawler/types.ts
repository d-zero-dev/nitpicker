import type { PageData, CrawlerError, Resource } from '../utils/index.js';
import type { ChangePhaseEvent } from '@d-zero/beholder';
import type { ParseURLOptions } from '@d-zero/shared/parse-url';

/**
 * Configuration options that control crawler behavior.
 *
 * Used by the result handler functions to determine how to process
 * scrape results, which URLs to follow, and how to handle external links.
 * @see {@link ./crawler.ts | Crawler} for the main consumer of this type
 * @see {@link ../crawler-orchestrator.ts | CrawlerOrchestrator} for factory methods that build these options
 */
export interface CrawlerOptions extends Required<
	Pick<ParseURLOptions, 'disableQueries'>
> {
	/** Delay in milliseconds between page requests. */
	interval: number;

	/** Maximum number of concurrent scraping processes. 0 uses the default. */
	parallels: number;

	/** Whether to recursively follow discovered links within the scope. */
	recursive: boolean;

	/** Whether the crawl was started from a pre-defined URL list. */
	fromList: boolean;

	/** Whether to capture image resources during scraping. */
	captureImages: boolean;

	/** Path to the Chromium/Chrome executable, or `null` for the bundled version. */
	executablePath: string | null;

	/** Whether to fetch and scrape external (out-of-scope) pages. */
	fetchExternal: boolean;

	/** List of scope URL strings that define the crawl boundary. */
	scope: string[];

	/** Glob patterns for URLs to exclude from crawling. */
	excludes: string[];

	/** Keywords that trigger page exclusion when found in content. */
	excludeKeywords: string[];

	/** URL prefixes to exclude from crawling (merged defaults + user additions). */
	excludeUrls: readonly string[];

	/** Maximum directory depth for excluded paths. */
	maxExcludedDepth: number;

	/** Maximum number of retry attempts per URL on scrape failure. */
	retry: number;

	/** Whether to enable verbose logging. */
	verbose: boolean;

	/** User-Agent string sent with HTTP requests. */
	userAgent: string;

	/** Whether to ignore robots.txt restrictions. */
	ignoreRobots: boolean;
}

/**
 * Describes a detected pagination pattern between two consecutive URLs.
 */
export interface PaginationPattern {
	/** Index within the combined token array (path segments + query values) where the numeric difference was found. */
	tokenIndex: number;
	/** The numeric increment (always > 0). */
	step: number;
	/** The number found at `tokenIndex` in the "current" URL. */
	currentNumber: number;
}

/**
 * Event map for the `Crawler` class.
 *
 * Each key represents an event name and its value is the payload type
 * passed to listeners subscribed via `on()` or `once()`.
 */
export interface CrawlerEventTypes {
	/**
	 * Emitted when a page within the crawl scope has been successfully scraped.
	 */
	page: {
		/** The scraped page data including HTML, metadata, anchors, and images. */
		result: PageData;
	};

	/**
	 * Emitted when an external page (outside the crawl scope) has been scraped.
	 */
	externalPage: {
		/** The scraped page data for the external page. */
		result: PageData;
	};

	/**
	 * Emitted when a URL is skipped due to exclusion rules, robots.txt restrictions,
	 * or external fetch being disabled.
	 */
	skip: {
		/** The URL that was skipped. */
		url: string;
		/** The reason the URL was skipped (e.g., "excluded", "blocked by robots.txt", or a JSON description). */
		reason: string;
		/** Whether the skipped URL is external to the crawl scope. */
		isExternal: boolean;
	};

	/**
	 * Emitted when a network resource (CSS, JS, image, etc.) is captured during page scraping.
	 */
	response: {
		/** The captured resource data including URL, status, content type, and headers. */
		resource: Resource;
	};

	/**
	 * Emitted to record the relationship between a page and a resource it references.
	 */
	responseReferrers: {
		/** The URL of the page that references the resource. */
		url: string;
		/** The URL of the referenced resource (without hash). */
		src: string;
	};

	/**
	 * Emitted when the entire crawl process has completed or been aborted.
	 */
	crawlEnd: Record<string, unknown>;

	/**
	 * Emitted when an error occurs during crawling.
	 */
	error: CrawlerError;

	/**
	 * Emitted when the scraper transitions between phases of the page scraping lifecycle
	 * (e.g., scrapeStart, headRequest, openPage, success).
	 */
	changePhase: ChangePhaseEvent;
}
