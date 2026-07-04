import type { PageSource } from '../archive/types.js';
import type { PageData, CrawlerError, Resource } from '../utils/types/types.js';
import type { ChangePhaseEvent, ScrapeResult } from '@d-zero/beholder';
import type { ParseURLOptions } from '@d-zero/shared/parse-url';

/**
 * Result of resolving a URL that redirects to a destination already rendered
 * during this crawl (#73). The crawler records the redirect edge only and skips
 * launching the browser, so the destination is never re-rendered.
 */
export interface RedirectEdgeResult {
	/** Discriminant marking this as a redirect-edge-only outcome. */
	type: 'redirect-edge';
	/** HEAD-resolved page data carrying the redirect chain (source → destination). */
	pageData: PageData;
	/**
	 * Where the chain came from. The caller needs this to decide whether the
	 * URLs in `pageData.redirectPaths` are already-known (HTTP chain — every
	 * hop was followed by the browser/HEAD pre-flight and the destination is
	 * already rendered) or brand-new (JS redirect — only the source was
	 * processed, the destination came out of `page.url()` and has never been
	 * touched).
	 *
	 * - `'http-chain'` — Returned when the HEAD pre-flight resolved a real
	 *   3xx chain and the destination has already been claimed via
	 *   `#scrapedDestinations`. The crawler folds every URL in
	 *   `redirectPaths` into the link-list's done-set; the destination is not
	 *   re-enqueued because it is already in the archive.
	 * - `'js-redirect'` — Returned when `scraper.scrapeStart` threw because
	 *   `page.goto()` resolved to `null` (client-side
	 *   `window.location.replace()` / `<meta http-equiv="refresh">`) and
	 *   `page.url()` exposed a different destination. `redirectPaths`
	 *   contains exactly one URL: the JS-redirect target. The crawler MUST
	 *   enqueue that destination so it reaches the browser, and MUST NOT
	 *   fold it into the done-set (otherwise the dealer's `seen` rejects
	 *   the push and the destination is silently lost from the archive).
	 */
	source: 'http-chain' | 'js-redirect';
}

/**
 * The outcome of {@link Crawler.#scrapePage}: either a normal scrape result from
 * the browser/HEAD pipeline, or a {@link RedirectEdgeResult} when the URL's
 * redirect destination was already rendered and only the edge needs recording.
 */
export type ScrapeOutcome = ScrapeResult | RedirectEdgeResult;

/**
 * Internal envelope returned by {@link Crawler.#launchBrowserAndScrape} that
 * augments beholder's {@link ScrapeResult} with the puppeteer-side
 * post-navigation URL.
 *
 * **Why:** when `scraper.scrapeStart` throws because `page.goto()` resolved to
 * `null` (the classic puppeteer symptom of a client-side
 * `window.location.replace()` / meta-refresh firing mid-navigation), the only
 * authoritative source for the URL the browser actually landed on is
 * `page.url()` — neither the HEAD pre-flight nor the thrown error carries it.
 * Capturing it here lets `#scrapePage` fold the source into a redirect edge
 * instead of recording a hard `status = -1` that `--retry-failed` would chase
 * forever (`Page.goto returned null` classifies as `protocol`, which is neither
 * permanent nor a puppeteer-fallback kind — so the SQL filter resets it every
 * pass and the next pass replays the same failure).
 *
 * `postNavigationUrl` is optional because:
 * - successful / skipped outcomes do not need it (the success path already
 *   exposes the final URL via `pageData.url` + `redirectPaths`);
 * - capturing can itself fail when the underlying browser context is already
 *   torn down (target closed, session killed) — we treat that as "no extra
 *   information" and fall through to the existing error path.
 */
export type BrowserScrapeResult = ScrapeResult & {
	/**
	 * URL puppeteer reports via `page.url()` *after* a thrown navigation.
	 *
	 * Semantically only meaningful when the parent result is `type: 'error'`
	 * — `#launchBrowserAndScrape` sets it from inside its catch arm, and the
	 * success / skipped paths never write to it. The field is typed as
	 * optional on the whole envelope rather than narrowed to the error
	 * variant because beholder's `ScrapeResult` is not a discriminated
	 * union (all variants share the same shape and disambiguate via
	 * `type`), so narrowing here would force a parallel ad-hoc union with
	 * no compile-time payoff. Consumers MUST therefore check
	 * `result.type === 'error'` before reading `postNavigationUrl` — and in
	 * practice the only consumer is the JS-redirect rescue, which does
	 * exactly that.
	 *
	 * Consumers should also confirm the URL is meaningful via
	 * `deriveJsRedirectTarget` — `about:blank`, identity values,
	 * case-only or trailing-slash variants are all filtered there, not
	 * here.
	 */
	postNavigationUrl?: string;
};

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

	/** Root URL strings that define the crawl boundary. Each root is also a scope entry (a `(hostname, port, path)` triple) — out-of-bound URLs are classified as external. */
	roots: string[];

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

	/**
	 * Lookup for previously captured sub-resources, or `null` to disable the
	 * resource-reuse optimization. See {@link ResourceLookup}.
	 */
	lookupResource: ResourceLookup | null;

	/**
	 * Lookup for an already-persisted page's `source` column, or `null` when
	 * lineage propagation across sessions is not required. See
	 * {@link PageSourceLookup}.
	 *
	 * Injected by the orchestrator so that `#scrapePage` can resolve the
	 * parent's source on `--resume` / `--retry-failed` paths, where
	 * `inventoryMode` is not persisted but the page's `source` column is.
	 * Without this, sub-resources captured during a re-render of an
	 * inventory-labelled page would fall back to the DB DEFAULT `'crawled'`
	 * and lose their `'inventory-discovered'` provenance.
	 */
	lookupPageSource: PageSourceLookup | null;

	/**
	 * When non-null, the crawler is running in `--inventory` mode. New page
	 * rows whose URL matches `seedUrls` are labelled `'inventory-seed'`;
	 * every other newly-inserted page or sub-resource is labelled
	 * `'inventory-discovered'`. When `null`, no source label is emitted —
	 * the DB DEFAULT `'crawled'` applies.
	 */
	inventoryMode: InventoryMode | null;
}

/**
 * Inventory-mode runtime configuration. Passed from
 * `CrawlerOrchestrator.inventory` into the Crawler so the emit pipeline can
 * label new rows with the correct {@link PageSource}.
 */
export interface InventoryMode {
	/**
	 * URLs explicitly listed in the user-supplied URL file, keyed by their
	 * `withoutHashAndAuth` form (so credentials in the URL don't break the
	 * match). Membership decides `inventory-seed` vs `inventory-discovered`
	 * for HTML pages.
	 */
	seedUrls: ReadonlySet<string>;
}

/**
 * Looks up a previously captured sub-resource by URL.
 *
 * Injected by the orchestrator so that the crawler can reuse network data
 * recorded during page rendering instead of issuing a redundant HEAD
 * pre-flight request. Implementations must serialize the read against any
 * pending resource writes (e.g., via the orchestrator's WriteQueue).
 * @param urls - URL candidates to match (e.g., with and without auth credentials).
 * @returns The recorded resource data, or `null` when no row matches.
 */
export type ResourceLookup = (
	urls: readonly string[],
) => Promise<ResourceLookupResult | null>;

/**
 * Looks up the `source` column of a previously persisted page by URL.
 *
 * Returns `undefined` when no row matches (e.g. a freshly-discovered URL
 * that has not been INSERTed yet) so the caller can fall through to its
 * default behaviour.
 *
 * Used by `Crawler` during sub-resource lineage propagation:
 * `#scrapePage` consults this once per page to resolve the parent's
 * lineage when the in-memory `inventoryMode` is unavailable (i.e. on
 * `--resume` / `--retry-failed` sessions where inventory state lives only
 * in the DB).
 * @param urlWithoutHashAndAuth - The URL key (`url.withoutHashAndAuth` form) to look up.
 * @returns The recorded `source`, or `undefined` when no matching row exists.
 */
export type PageSourceLookup = (
	urlWithoutHashAndAuth: string,
) => Promise<PageSource | undefined>;

/**
 * Minimal sub-resource data needed to synthesize {@link PageData}
 * without performing a network fetch.
 */
export interface ResourceLookupResult {
	/** HTTP status code of the recorded response, or `null` if unknown. */
	status: number | null;

	/** HTTP status text of the recorded response, or `null` if unknown. */
	statusText: string | null;

	/** The Content-Type header value (media type only), or `null` if unknown. */
	contentType: string | null;

	/** The Content-Length header value in bytes, or `null` if unknown. */
	contentLength: number | null;

	/** Raw HTTP response headers, or `null` if unavailable. */
	responseHeaders: Record<string, string | string[] | undefined> | null;
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
		/**
		 * Inventory provenance to write to `pages.source` when this row is new.
		 * `undefined` means the DB default (`'crawled'`) applies, which is the
		 * common case outside `crawl --inventory`. See {@link PageSource}.
		 */
		source?: PageSource;
	};

	/**
	 * Emitted when an external page (outside the crawl scope) has been scraped.
	 */
	externalPage: {
		/** The scraped page data for the external page. */
		result: PageData;
		/** Inventory provenance for new rows — see `CrawlerEventTypes.page.source`. */
		source?: PageSource;
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
		/**
		 * Inventory provenance to write to `resources.source` when this row is new.
		 * Sub-resources discovered while puppeteer renders an inventory-seed
		 * page are always `'inventory-discovered'` (a sub-resource is never
		 * itself a seed). `undefined` means the DB default (`'crawled'`)
		 * applies. See {@link PageSource}.
		 */
		source?: PageSource;
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

	/**
	 * Emitted when a secondary scrape step fails for a URL but the page itself
	 * is otherwise scraped successfully (e.g. a viewport switch in
	 * `#fetchImages` detaches the frame and `@retryable` gives up). The
	 * orchestrator persists these as `page_errors` rows so the failure is
	 * visible in the archive instead of being lost to stdout logs.
	 *
	 * For ordering, this event is always emitted AFTER `page` / `externalPage`
	 * for the same URL, so the orchestrator's WriteQueue serialises the
	 * `pages` upsert before the `page_errors` insert and the FK resolution
	 * via URL succeeds.
	 */
	pageError: {
		/** URL of the affected page. */
		url: string;
		/** Scrape phase name (typically `'retryExhausted'`). */
		phase: string;
		/** Human-readable failure message. */
		message: string;
		/** Whether the URL is external to the crawl scope. */
		isExternal: boolean;
	};

	/**
	 * Emitted when a URL redirects to a destination that has already been
	 * rendered during this crawl, so only the redirect edge is recorded and the
	 * destination is not re-rendered (#73). The orchestrator persists this via
	 * `Archive.setRedirect`, which writes the edge without overwriting the
	 * destination's content.
	 */
	redirect: {
		/** HEAD-resolved page data carrying the redirect chain (source → destination). */
		result: PageData;
		/**
		 * Inventory provenance for the redirect-edge call. Forwarded by the
		 * orchestrator to `Archive.setRedirect` → `Database.recordRedirect`
		 * so brand-new destination rows INSERTed by the edge-only path pick
		 * up the inventory label (and propagate it to intermediates) when
		 * the originating chain is in the inventory chain. `undefined` keeps
		 * the DB DEFAULT `'crawled'`.
		 */
		source: PageSource | undefined;
	};
}
