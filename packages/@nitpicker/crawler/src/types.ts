import type { APPEND_SETUP_PHASES } from './append-setup-phases.js';
import type { INVENTORY_SETUP_PHASES } from './inventory-setup-phases.js';
import type { RECRAWL_SETUP_PHASES } from './recrawl-setup-phases.js';
import type { RESUME_SETUP_PHASES } from './resume-setup-phases.js';
import type { RETRY_FAILED_SETUP_PHASES } from './retry-failed-setup-phases.js';
import type { SETUP_RECOVERY_PHASE_LABELS } from './setup-recovery-phase-labels.js';
import type { CrawlerError, PageData } from './utils/types/types.js';

/**
 * Every label `SetupProgressCallbacks.onPhase` can be called with, across
 * all five `CrawlerOrchestrator` setup sequences plus the failure-only
 * recovery phases. See `RESUME_SETUP_PHASES` / `APPEND_SETUP_PHASES` /
 * `RETRY_FAILED_SETUP_PHASES` / `INVENTORY_SETUP_PHASES` /
 * `RECRAWL_SETUP_PHASES` / `SETUP_RECOVERY_PHASE_LABELS` for what each label
 * means and when it fires.
 */
export type SetupPhaseLabel =
	| (typeof RESUME_SETUP_PHASES)[number]
	| (typeof APPEND_SETUP_PHASES)[number]
	| (typeof RETRY_FAILED_SETUP_PHASES)[number]
	| (typeof INVENTORY_SETUP_PHASES)[number]
	| (typeof RECRAWL_SETUP_PHASES)[number]
	| (typeof SETUP_RECOVERY_PHASE_LABELS)[number];

/**
 * Progress callbacks for the setup phase of `CrawlerOrchestrator.append` /
 * `inventory` / `retryFailed` / `resume` (issue #294) — everything from
 * `Archive.open`'s untar through `Crawler#resume`'s in-memory state rebuild,
 * which all runs **before** `initializedCallback` fires (before the CLI's
 * event-based progress display — `attachCrawlDisplay` — has anything to
 * subscribe to). A large archive's setup can itself take tens of seconds to
 * minutes (untar, `.bak` copy, chunked page/resource re-scans), and without
 * this it looked completely silent — including before the CLI's own
 * "🐳 archive (...)" header line, which normally establishes that the
 * process is even alive.
 *
 * Passed as a plain callback object (not routed through the orchestrator's
 * event emitter) because the orchestrator instance the emitter lives on
 * does not exist yet for most of this phase — `Archive.open`, the `.bak`
 * copy, and the pre-`new CrawlerOrchestrator(...)` scope/repromote work all
 * run before there is anything to attach a listener to.
 */
export interface SetupProgressCallbacks {
	/**
	 * Called once at the start of each named setup step that has no
	 * countable progress of its own (a single query, an in-memory rebuild).
	 * @param label - Human-readable description of the step starting.
	 */
	onPhase?: (label: SetupPhaseLabel) => void;
	/**
	 * Called during `Archive.open`'s tar extraction, with bytes read so far
	 * and the archive's total size.
	 */
	onExtractProgress?: (readBytes: number, totalBytes: number) => void;
	/**
	 * Called during a `.bak` backup or restore copy, with bytes copied so
	 * far and the source file's total size — the pre-mutation backup and
	 * the on-failure restore both go through this one callback; the
	 * caller's own {@link SetupProgressCallbacks.onPhase} call immediately
	 * before distinguishes which copy is running.
	 */
	onCopyProgress?: (copiedBytes: number, totalBytes: number) => void;
	/**
	 * Called for chunked/keyset-scan progress within whichever named phase
	 * is currently running (`repromoteExternalPages`, `getResourceUrlList`,
	 * `resetFailedPages`) — the unit varies by phase (pages processed vs.
	 * ids scanned), so callers label it using the most recent `onPhase`
	 * call.
	 * @param processed - Units completed so far, including this update.
	 * @param total - Total units this phase will process.
	 */
	onChunkProgress?: (processed: number, total: number) => void;
	/**
	 * Called instead of `console.error` for self-healing schema migration
	 * notices that can fire during `Archive.open`/`Archive.resume` while
	 * this setup phase's own `Lanes`/`TaskList` display is active (issue
	 * #294) — a bare `console.error` there corrupts the display's cursor
	 * tracking. Forwarded to {@link import('../archive/archive.js').ArchiveOpenOptions.onLog}.
	 * Omit to fall back to `console.error`.
	 */
	onLog?: (message: string) => void;
}

/**
 * Aggregate counts captured during a `--inventory` or `--recrawl`
 * invocation, forwarded to `#writeInventoryRunRow` so the audit log row is
 * consistent across every branch of `CrawlerOrchestrator.inventory` and
 * `CrawlerOrchestrator.recrawl` that reaches ingestion.
 *
 * Spelled out here (not inlined at the call site) so a new field added to
 * the audit row has a single edit point and so each field's semantics are
 * documented per-property rather than scattered across the emit sites.
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
	/**
	 * Overrides the audit row's `list_label` prefix (before the `-${ranAt}`
	 * timestamp suffix `#writeInventoryRunRow` always appends). Omit for the
	 * default `'inventory'`; `CrawlerOrchestrator.recrawl` passes `'recrawl'`
	 * so the two invocation kinds stay distinguishable in `query
	 * inventory-runs` output despite sharing one audit table.
	 */
	listLabelPrefix?: string;
	/**
	 * Free-form text stored verbatim as `inventory_runs.notes`. `recrawl`
	 * uses this to record how many existing pages it reset back to
	 * pending — a fact `--inventory` never produces and that therefore has
	 * no dedicated column (adding one would leave it `NULL` on every
	 * `--inventory` row forever). `null`/omitted leaves the column `NULL`,
	 * matching `--inventory`'s existing rows.
	 */
	notes?: string | null;
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
	 * Emitted once at the start of each of `Archive.write()`'s internal
	 * steps (issue #294) — `checkpoint`/`remove` have no countable progress
	 * of their own (a single synchronous PRAGMA and a directory removal),
	 * so without this a large archive's write looks frozen between
	 * `writeFileStart` and the `writeTarProgress` byte updates.
	 */
	writeStep: {
		/** Which step of `Archive.write()` is starting. */
		step: 'checkpoint' | 'rename' | 'tar' | 'remove';
	};

	/**
	 * Emitted as archive bytes are written during `Archive.write()`'s tar
	 * step (issue #294) — tarring a large (15 GB+) archive can take minutes,
	 * and without this the CLI shows nothing between `writeStep: 'tar'` and
	 * `writeFileEnd`.
	 */
	writeTarProgress: {
		/** Bytes written so far. */
		writtenBytes: number;
		/** Estimated total bytes (sum of source file sizes; tar adds headers/padding). */
		totalBytes: number;
	};

	/**
	 * Emitted as pages are re-ordered after crawling completes (issue #294)
	 * — `setUrlOrder()` loads every internal page, sorts it in JS, then
	 * writes the result back in chunks, which can take seconds to minutes
	 * on a large archive with no other signal it hasn't hung.
	 */
	sortingUrls: {
		/** Pages assigned an order so far. */
		processed: number;
		/** Total internal pages being ordered. */
		total: number;
	};

	/**
	 * Emitted once, only when `[Symbol.asyncDispose]`'s call to
	 * `Archive.close()` discovers the archive file doesn't exist on disk
	 * yet and falls back to writing it there (issue #294) — e.g. the
	 * caller's own explicit `CrawlerOrchestrator.write()` threw partway
	 * through (network/disk error during tar) before finishing. Emitted
	 * before the `writeStep`/`writeTarProgress` events this recovery write
	 * reuses, so a listener knows why a fresh write is starting after one
	 * already appeared to fail.
	 */
	recoveringArchiveWrite: Record<string, never>;

	/**
	 * Emitted once, right before `crawlEnd`'s final `WriteQueue.drain()`,
	 * when that queue still has enqueued-but-not-yet-executed writes (issue
	 * #294) — the deal's own per-page progress display has already stopped
	 * updating by this point (the crawler itself is done), so a queue still
	 * draining page/resource INSERTs would otherwise look like the process
	 * hung between the last progress line and the archive write starting.
	 * Not emitted when the queue is already empty — nothing to wait on, so
	 * nothing to explain.
	 */
	flushingPendingWrites: {
		/** Enqueued operations still waiting or executing at emission time. */
		pending: number;
	};

	/**
	 * Emitted once per session-summary notice `#finalizeCrawlSession` has to
	 * report — the DNS-burned-host short-circuit count and/or the
	 * network-outage summary, each only when its count is nonzero (issue
	 * #294 code review). Fires in the same crawl-tail window as
	 * `flushingPendingWrites`/`sortingUrls` (after crawling finishes, before
	 * the static factory method returns), so a listener can route it the
	 * same way instead of a bare `console.error` corrupting whatever
	 * `Lanes`/`TaskList` display happens to be active at that point.
	 */
	crawlSessionNotice: {
		/** The formatted, ready-to-display notice text. */
		message: string;
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
