import type { CrawlRuntimeOptionsPatch } from '@nitpicker/crawler';

/**
 * Parsed result of one line typed into the crawl console (`create-crawl-console.ts`).
 * `'patch'` carries the `CrawlRuntimeOptionsPatch` to apply plus a `label`
 * describing the command for `format-crawl-console-result.ts`; `'help'` and
 * `'empty'` need no further action; `'error'` carries a user-facing message
 * for an unrecognized command or bad argument.
 */
export type CrawlConsoleCommandResult =
	| {
			readonly kind: 'patch';
			readonly patch: CrawlRuntimeOptionsPatch;
			readonly label: string;
	  }
	| { readonly kind: 'help' }
	| { readonly kind: 'empty' }
	| { readonly kind: 'error'; readonly message: string };

/**
 * The subset of `process.stdin`'s interface `create-crawl-console.ts` needs.
 * Narrowed so tests can pass a fake `EventEmitter`-backed double instead of
 * mutating the real `process.stdin` (raw mode, encoding) during a test run.
 */
export interface CrawlConsoleInput {
	readonly isTTY?: boolean;
	setRawMode(mode: boolean): unknown;
	setEncoding(encoding: BufferEncoding): unknown;
	on(event: 'data', listener: (chunk: string) => void): unknown;
	off(event: 'data', listener: (chunk: string) => void): unknown;
	resume(): unknown;
	pause(): unknown;
}

/** Return value of `createCrawlConsole` — the only way to release stdin/the Lanes footer. */
export interface CrawlConsoleHandle {
	/**
	 * Restores stdin (raw mode off, listener removed, paused) and clears the
	 * footer line. Idempotent.
	 */
	dispose(): void;
}

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
	/** See `crawl-def.ts`'s `maxAutoRetry` flag description (issue #350). */
	readonly maxAutoRetry?: number;
	/** Custom User-Agent string for HTTP requests. */
	readonly userAgent?: string;
	/** Whether to ignore robots.txt restrictions. */
	readonly ignoreRobots?: boolean;
	/** Whether to enable verbose logging output. */
	readonly verbose?: boolean;
	/** CSS selector overriding beholder's automatic main-content detection. */
	readonly mainContentSelector?: string;
	/** Same-cluster soft-cap threshold. `undefined` disables the feature (mapped to `null`). */
	readonly dedupeCap?: number;
	/** Hard cap on the number of distinct URL shapes `dedupeCap` tracks at once. */
	readonly dedupeMapCap?: number;
}
