/**
 * CLI crawl flag names that need to be mapped to CrawlConfig properties.
 *
 * CLI flags use singular names (e.g., `exclude`) for better UX,
 * while the internal CrawlConfig uses plural names (e.g., `excludes`).
 * This interface captures the subset of CLI flags relevant to crawl configuration.
 */
export interface CrawlFlagInput {
	/** Excluding page URL path (glob pattern). Maps to `excludes` in CrawlConfig. */
	readonly exclude?: string[];
	/** Exclude keyword in document of page. Maps to `excludeKeywords` in CrawlConfig. */
	readonly excludeKeyword?: string[];
	/** Exclude external URL prefix. Maps to `excludeUrls` in CrawlConfig. */
	readonly excludeUrl?: string[];
	/** Comma-separated scope hosts/URLs. Parsed into a string array in CrawlConfig. */
	readonly scope?: string;
	/** An interval time on request when crawling. */
	readonly interval?: number;
	/** Whether to collect image data during crawling. */
	readonly image?: boolean;
	/** Whether to fetch external links. */
	readonly fetchExternal?: boolean;
	/** Number of parallel scraping processes. */
	readonly parallels?: number;
	/** Whether to recursively follow links. */
	readonly recursive?: boolean;
	/** Whether to disable URL query strings. */
	readonly disableQueries?: boolean;
	/** Image file size threshold in bytes. */
	readonly imageFileSizeThreshold?: number;
	/** Maximum directory depth for excluded paths. */
	readonly maxExcludedDepth?: number;
	/** Maximum number of retry attempts per URL on scrape failure. */
	readonly retry?: number;
	/** Custom User-Agent string for HTTP requests. */
	readonly userAgent?: string;
	/** Whether to ignore robots.txt restrictions. */
	readonly ignoreRobots?: boolean;
	/** Whether to enable verbose logging output. */
	readonly verbose?: boolean;
}
