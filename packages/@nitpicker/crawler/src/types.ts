import type { CrawlerError, PageData } from './utils/types/types.js';

/**
 * Aggregate counts captured during a `--inventory` invocation, forwarded to
 * `#writeInventoryRunRow` so the audit log row is consistent between the
 * HTML-seed branch and the non-HTML-only branch of
 * `CrawlerOrchestrator.inventory`.
 *
 * Spelled out here (not inlined at the call site) so a new field added to
 * the audit row has a single edit point and so each field's semantics are
 * documented per-property rather than scattered across the two emit sites.
 */
export interface InventoryRunAggregates {
	/** `inventoryUrls.length` as received by `CrawlerOrchestrator.inventory` — the CLI (`inventoryCrawl`) has already warned-and-dropped unparseable-URL lines before this point, so this counts valid URLs, not raw source-file lines. Stored verbatim as `inventory_runs.total_lines`. */
	inventoryUrlsCount: number;
	/** Number of novel URLs classified as HTML and queued for render. Stored as `new_pages` (excludes anchor-discovered descendants — those add later via the crawler graph and are NOT counted here). */
	htmlSeedsCount: number;
	/** Number of novel URLs classified as non-HTML and written directly into `resources`. Stored as `new_resources`. */
	nonHtmlCount: number;
	/** URLs dropped because they fell outside the archived scope. Stored as `scope_skipped`. */
	outOfScope: number;
	/** Novel in-scope URLs recorded as terminal skipped pages (`is_skipped=1`, `skip_reason='excluded'`) instead of being imported, because they matched the effective `excludes` / `excludeUrls` config — the same inputs the scrape phase's fetch-time `shouldSkipUrl` gate uses. Stored as `exclude_skipped`. */
	excludeSkipped: number;
	/**
	 * SHA-256 hex digest of the source `.txt`, **pre-computed by the caller**
	 * (typically the CLI's `inventoryCrawl`). Stored verbatim as
	 * `inventory_runs.source_file_sha256`.
	 *
	 * Pre-computation lifts the absolute path off the orchestrator
	 * boundary entirely — the path is privacy-sensitive (leaks
	 * user-home / OS structure when archives are shared), and the
	 * orchestrator has no business handling it after the audit-row
	 * column was dropped. Pass `null` for programmatic callers that
	 * built `inventoryUrls` in-memory; the audit row's
	 * `source_file_sha256` will be `NULL`.
	 */
	sourceFileSha256: string | null;
	/**
	 * Number of source-file lines the CLI warned-and-dropped for failing
	 * URL validation, before `inventoryUrlsCount` was ever counted. Stored
	 * verbatim as `inventory_runs.invalid_skipped`. `null` for programmatic
	 * callers that built `inventoryUrls` in-memory — there is no source
	 * file, so no line was ever dropped as invalid.
	 */
	invalidSkipped: number | null;
}

/**
 * Coarse cause of a crawl/scrape failure.
 *
 * The crawler stores only the raw error message (in `crawl_errors`,
 * `page_errors`, or `error.log`); the cause is derived on read by
 * `classifyErrorKind`, so existing archives gain classification without a
 * re-crawl.
 *
 * Owned by the crawler package because both the crawler (for DNS-burned host
 * caching) and `@nitpicker/query` (for `getErrorKinds` / `getSummary`) need to
 * classify error messages, and crawler cannot depend on query.
 *
 * ### transient vs persistent
 *
 * | kind | transient? | DNS-burn? | notes |
 * | --- | --- | --- | --- |
 * | `dns` | no | yes | NXDOMAIN; the host does not resolve at all |
 * | `dns-transient` | **yes** | no | `EAI_AGAIN`; local resolver hiccup, retry often recovers |
 * | `tls` | no | no | certificate issue, usually persistent until cert rotates |
 * | `connection-refused` | mostly persistent | no | server actively rejecting on this port |
 * | `connection-reset` | yes | no | TCP reset mid-stream, often transient |
 * | `connection-timeout` | yes | no | TCP-level timeout (`ETIMEDOUT`); slow but reachable |
 * | `local-network` | **yes** | no | local machine's network is unreachable / changed (WiFi, sleep, ICMP-unreachable, …) |
 * | `parse-error` | mostly persistent | no | HTTP response could not be parsed (proxy, garbage, MITM) |
 * | `client-blocked` | persistent (per browser) | no | Chromium-side `ERR_BLOCKED_BY_*` family — the browser actively refused the request (ad/tracker heuristics, CSP, CORP, administrator block list, …) |
 * | `redirect-loop` | no | no | the redirect chain exceeded `follow-redirects`' `maxRedirects` limit — the site's own redirect configuration never converges |
 * | `protocol` | yes | no | puppeteer protocol layer (frame detached, target closed, …) |
 * | `timeout` | yes | no | puppeteer navigation timeout or HEAD pre-flight race timeout (`Timeout: <url>`) |
 * | `unknown` | unknown | no | catch-all for messages no matcher recognised |
 *
 * Only `dns` is mark-target for the DNS-burned host cache; everything else is
 * either too transient to burn (network glitch / browser hiccup) or too
 * server-specific to extrapolate to "this whole host is dead."
 *
 * ### Derived constants that MUST be reviewed when this union changes
 *
 * - `PERMANENT_ERROR_KINDS` (`permanent-error-kinds.ts`) — the set of kinds
 *   excluded from `--retry-failed` so retry iterations actually converge.
 *   A new kind that is deterministically permanent (server-state, cert,
 *   browser-block, …) likely belongs here.
 * - `PUPPETEER_FALLBACK_KINDS` (`crawler/is-puppeteer-fallback-candidate.ts`)
 *   — the set of kinds where one puppeteer attempt has a realistic chance
 *   of succeeding after HEAD+GET pre-flight exhausted retries. A new kind
 *   modelling a middlebox / WAF / slow-server quirk likely belongs here.
 *
 * Adding a kind without reviewing both sets risks a silent regression:
 * `--retry-failed` re-trying a permanent failure forever (no PERMANENT
 * entry), or a recoverable URL never reaching the puppeteer fallback (no
 * PUPPETEER_FALLBACK entry).
 */
export type ErrorKind =
	| 'dns'
	| 'dns-transient'
	| 'connection-refused'
	| 'connection-reset'
	| 'connection-timeout'
	| 'tls'
	| 'local-network'
	| 'parse-error'
	| 'client-blocked'
	| 'redirect-loop'
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
