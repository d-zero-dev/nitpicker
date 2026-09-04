import type { Config } from './archive/types.js';
import type { NetworkProbe } from './crawler/probe-network.js';
import type {
	CrawlerEventTypes,
	CrawlerOptions,
	InventoryMode,
} from './crawler/types.js';
import type {
	CrawlEvent,
	ListReconcileRunAggregates,
	PendingUrlsRemainReason,
	SetupPhaseLabel,
	SetupProgressCallbacks,
} from './types.js';
import type { ExURL } from '@d-zero/shared/parse-url';

import { unlink as unlinkFile } from 'node:fs/promises';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { sortUrl } from '@d-zero/shared/sort-url';
import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';

import pkg from '../package.json' with { type: 'json' };

import { APPEND_SETUP_PHASES } from './append-setup-phases.js';
import Archive from './archive/archive.js';
import { copyFileWithProgress } from './archive/filesystem/copy-file-with-progress.js';
import { REQUIRED_FORMAT_VERSION } from './archive/meta/assert-compatible-version.js';
import { computeAutoRetryBackoffDelayMs } from './compute-auto-retry-backoff-delay.js';
import { clearDestinationCache } from './crawler/clear-destination-cache.js';
import { clearDnsBurnedHostCache } from './crawler/clear-dns-burned-host-cache.js';
import Crawler from './crawler/crawler.js';
import { dnsBurnedHostCache } from './crawler/dns-burned-host-cache.js';
import { dnsBurnedHostShortCircuitCounter } from './crawler/dns-burned-host-short-circuit-counter.js';
import { findScopeEntry } from './crawler/find-scope-entry.js';
import { isLikelyHtmlUrl } from './crawler/is-likely-html-url.js';
import { networkOutageSummaryCounter } from './crawler/network-outage-summary-counter.js';
import { PreloadShortCircuitError } from './crawler/preload-short-circuit-error.js';
import { protocolAgnosticKey } from './crawler/protocol-agnostic-key.js';
import { shouldSkipUrl } from './crawler/should-skip-url.js';
import { crawlerLog, log } from './debug.js';
import { delayOrAbort } from './delay-or-abort.js';
import { INVENTORY_SETUP_PHASES } from './inventory-setup-phases.js';
import { normalizeToArray } from './normalize-to-array.js';
import { PendingUrlsRemainError } from './pending-urls-remain-error.js';
import { RECRAWL_SETUP_PHASES } from './recrawl-setup-phases.js';
import { resolveOutputPath } from './resolve-output-path.js';
import { resourceRowToLookupResult } from './resource-row-to-lookup-result.js';
import { RESUME_SETUP_PHASES } from './resume-setup-phases.js';
import { RETRY_FAILED_SETUP_PHASES } from './retry-failed-setup-phases.js';
import { SETUP_RECOVERY_PHASE_LABELS } from './setup-recovery-phase-labels.js';
import { cleanObject } from './utils/object/clean-object.js';
import { WriteQueue } from './write-queue.js';

const [RECOVERY_RESTORE_FROM_BACKUP, RECOVERY_LEAVE_STATE_FOR_RESUME] =
	SETUP_RECOVERY_PHASE_LABELS;

/**
 * Default list of external URL prefixes excluded from crawling.
 * Includes social media sharing endpoints that are commonly linked
 * but provide no useful crawl data.
 * @example
 * // Merged ahead of user-supplied excludeUrls when a crawl starts:
 * const excludeUrls = [...DEFAULT_EXCLUDED_EXTERNAL_URLS, 'https://ads.example.com'];
 */
export const DEFAULT_EXCLUDED_EXTERNAL_URLS = [
	'https://social-plugins.line.me',
	'https://access.line.me',
	'https://lineit.line.me',
	'https://line.me',
	'https://plus.google.com',
	'https://twitter.com',
	'https://x.com',
	'https://www.facebook.com/share.php',
	'https://www.facebook.com/share/',
	'https://www.facebook.com/sharer/',
	'https://www.facebook.com/share_channel/',
	'https://www.google.com',
];

/**
 * Configuration options for the CrawlerOrchestrator.
 *
 * Extends the archive {@link Config} with additional runtime settings
 * such as working directory, browser executable path, and output options.
 */
interface CrawlConfig extends Config {
	/** The working directory for output files. Defaults to `process.cwd()`. */
	cwd: string;

	/** Path to a Chromium/Chrome executable for Puppeteer. */
	executablePath: string;

	/** Output file path for the archive. */
	filePath: string;

	/** Whether to capture image resources during crawling. */
	image: boolean;

	/** File-size threshold (in bytes) above which images are excluded. */
	imageFileSizeThreshold: number;

	/** Delay in milliseconds between each page request. */
	interval: number;

	/** Whether the input is a pre-defined URL list (non-recursive mode). */
	list: boolean;

	/** Maximum number of retry attempts per URL on scrape failure. */
	retry: number;

	/**
	 * Maximum number of whole-session auto-retry attempts (issue #350) when
	 * a crawl session ends with pages still pending — each attempt re-queues
	 * the current pending set and re-runs the crawl loop, with an
	 * exponential backoff between attempts (see
	 * `computeAutoRetryBackoffDelayMs`). `0` disables auto-retry entirely:
	 * any pending pages after the session's first (and only) crawl pass
	 * abort the session immediately. See
	 * `CrawlerOrchestrator`'s `#crawlUntilPendingClears` for the full loop.
	 */
	maxAutoRetry: number;

	/** Whether to enable verbose logging output. */
	verbose: boolean;

	/** Custom User-Agent string for HTTP requests. */
	userAgent: string;

	/** Whether to ignore robots.txt restrictions. */
	ignoreRobots: boolean;

	/**
	 * Inventory-mode runtime configuration (see {@link InventoryMode}). Set
	 * by {@link CrawlerOrchestrator.inventory}; the default crawl path leaves
	 * this `null` so new rows are labelled `'crawled'` by the DB DEFAULT.
	 */
	inventoryMode: InventoryMode | null;

	/**
	 * See {@link CrawlerOptions.networkOutageWindowMs}. Omitted (`undefined`
	 * on the `Partial<CrawlConfig>` callers actually pass) falls through to
	 * `Crawler`'s own default — this field exists so tests can shrink the
	 * window for a fast, deterministic outage-detection cycle.
	 */
	networkOutageWindowMs: number;

	/** See {@link CrawlerOptions.networkOutageErrorThreshold}. */
	networkOutageErrorThreshold: number;

	/** See {@link CrawlerOptions.networkOutageHostThreshold}. */
	networkOutageHostThreshold: number;

	/** See {@link CrawlerOptions.networkOutageProbeIntervalMs}. */
	networkOutageProbeIntervalMs: number;

	/**
	 * See {@link CrawlerOptions.networkProbe}. The seam tests use to simulate
	 * confirmed outages and recoveries deterministically without touching
	 * the real network — plumbed through from `CrawlerOrchestrator.crawling`'s
	 * `options` so an E2E test can inject it via the public API.
	 */
	networkProbe: NetworkProbe | null;

	/** See {@link CrawlerOptions.dedupeCap}. `null`/omitted disables the feature. */
	dedupeCap: number | null;

	/** See {@link CrawlerOptions.dedupeMapCap}. Omitted falls through to `Crawler`'s own default. */
	dedupeMapCap: number;

	/**
	 * See {@link CrawlerOptions.preloadedStickyShapeKeys}. Set internally by
	 * the five resuming-session static methods
	 * (`append`/`inventory`/`recrawl`/`retryFailed`/`resume`), each
	 * independently calling `archive.listDedupeCapShapeKeys()`; not part of
	 * the public options a caller of those methods passes directly.
	 */
	preloadedStickyShapeKeys: readonly string[];
}

/**
 * Callback invoked after the CrawlerOrchestrator instance is fully initialized
 * but before crawling begins.
 * @param orchestrator - The initialized CrawlerOrchestrator instance.
 * @param config - The resolved archive configuration.
 */
type CrawlInitializedCallback = (
	orchestrator: CrawlerOrchestrator,
	config: Config,
) => void | Promise<void>;

/**
 * The CLI's already-read `--inventory` source list, passed to
 * {@link CrawlerOrchestrator.inventory} instead of a file path — see that
 * method's `source` param for why the path itself never crosses this
 * boundary.
 */
interface InventorySource {
	/** Lower-case hex SHA-256 digest of `bytes` (`computeFileSha256(bytes)`). */
	sha256: string;
	/** The exact bytes of the source list file, archived verbatim. */
	bytes: Buffer;
	/** Number of source-file lines the CLI warned-and-dropped for failing URL validation, before `inventoryUrls` was ever built. Recorded on the audit row as `list_reconcile_runs.invalid_skipped`. */
	invalidLineCount: number;
}

/**
 * The main entry point for Nitpicker web crawling and archiving.
 *
 * CrawlerOrchestrator orchestrates the full lifecycle of a crawl session: it creates an archive,
 * configures a {@link Crawler}, processes discovered pages and resources, and
 * writes the final archive file. It emits events defined by {@link CrawlEvent}.
 *
 * Instances are created via the static factory methods {@link CrawlerOrchestrator.crawling}
 * or {@link CrawlerOrchestrator.resume}; the constructor is private. Implements
 * `Symbol.asyncDispose` so callers can use `await using` to close the archive
 * and reap zombie Chromium processes on scope exit instead of a manual
 * `try`/`finally` around `archive.close()` + `garbageCollect()`.
 * @example
 * ```ts
 * await using orchestrator = await CrawlerOrchestrator.crawling(['https://example.com'], { recursive: true });
 * await orchestrator.write();
 * ```
 */
export class CrawlerOrchestrator extends EventEmitter<CrawlEvent> {
	/** The archive instance for persisting crawl results to SQLite + tar. */
	readonly #archive: Archive;
	/**
	 * Set when the archive's own `'error'` event fires (a DB/storage-level
	 * failure — see the constructor's listener), so
	 * `#crawlUntilPendingClears` can tell "the session ended because pages
	 * are still pending" apart from "the underlying storage broke" (issue
	 * #350). Retrying scrape work cannot fix the latter, so the auto-retry
	 * loop re-throws it immediately instead of burning retry attempts
	 * against it — `crawling()`'s own promise resolves normally either way
	 * (the constructor's listener only aborts the crawler; it does not
	 * reject anything), so this flag is the only way to distinguish the
	 * two after the fact.
	 */
	#archiveFailure: Error | null = null;
	/** The crawler engine that discovers and scrapes pages. */
	readonly #crawler: Crawler;
	/**
	 * Monotonic counter bumped on every `crawling()` call — see that
	 * method's JSDoc for why its listeners key off this instead of relying
	 * on listener removal.
	 */
	#crawlGeneration = 0;
	/**
	 * `dedupe_cap_events.id` for each shape confirmed capped this session, so
	 * `crawlEnd` can look up the right row to finalize with
	 * `Crawler#getDedupeCapRejections`'s counts. A `Map` (not a single
	 * scalar like {@link #openNetworkOutageId}) because, unlike a network
	 * outage, more than one shape can be capped simultaneously within one
	 * crawl.
	 */
	readonly #dedupeCapEventIds = new Map<string, number>();

	/** Whether the crawl was started from a pre-defined URL list (non-recursive mode). */
	readonly #fromList: boolean;
	/** See `CrawlConfig.maxAutoRetry`'s JSDoc. */
	readonly #maxAutoRetry: number;
	/**
	 * The `network_outages` row id for the currently-open outage, or `null`
	 * when none is open. Set by the `networkOutageConfirmed` handler (once
	 * the INSERT resolves) and consumed by `networkOutageRecovered` — the
	 * `Crawler` class never touches the archive itself and has no way to
	 * know the row's id, so the orchestrator is the only place that can
	 * bridge the two events for the same outage.
	 */
	#openNetworkOutageId: number | null = null;
	/** `startedAt` of the currently-open outage, tracked alongside {@link #openNetworkOutageId} so `networkOutageRecovered` can compute a duration for {@link networkOutageSummaryCounter}. */
	#openNetworkOutageStartedAt: number | null = null;
	/** Serializes archive writes from crawler event handlers (FIFO). */
	readonly #writeQueue = new WriteQueue();

	/**
	 * The underlying archive instance used for storing crawl results.
	 */
	get archive() {
		return this.#archive;
	}

	// eslint-disable-next-line no-restricted-syntax
	private constructor(archive: Archive, options?: Partial<CrawlConfig>) {
		super();

		this.#fromList = !!options?.list;
		this.#maxAutoRetry = options?.maxAutoRetry ?? 3;
		this.#archive = archive;
		this.#archive.on('error', (e) => {
			this.#archiveFailure = e instanceof Error ? e : new Error(String(e));
			this.#crawler.abort();
			void this.emit('error', {
				pid: process.pid,
				isMainProcess: true,
				url: null,
				isExternal: false,
				error: this.#archiveFailure,
			});
		});

		const defaultUserAgent = `Nitpicker/${pkg.version}`;
		this.#crawler = new Crawler({
			interval: options?.interval || 0,
			parallels: options?.parallels || 0,
			captureImages: options?.image,
			executablePath: options?.executablePath || null,
			fetchExternal: options?.fetchExternal ?? true,
			recursive: options?.recursive ?? true,
			roots: options?.roots ?? [],
			excludes: normalizeToArray(options?.excludes),
			excludeKeywords: normalizeToArray(options?.excludeKeywords),
			excludeUrls: [
				...DEFAULT_EXCLUDED_EXTERNAL_URLS,
				...normalizeToArray(options?.excludeUrls),
			],
			maxExcludedDepth: options?.maxExcludedDepth || 10,
			retry: options?.retry ?? 3,
			disableQueries: options?.disableQueries,
			verbose: options?.verbose ?? false,
			userAgent: options?.userAgent || defaultUserAgent,
			ignoreRobots: options?.ignoreRobots ?? false,
			mainContentSelector: options?.mainContentSelector ?? null,
			// Let the crawler reuse sub-resource data captured during page
			// rendering instead of issuing a redundant HEAD pre-flight.
			lookupResource: async (urls) => {
				// Fast path: read directly — the row is usually flushed long
				// before the queued URL is dequeued, and a direct read does not
				// block behind pending writes.
				const direct = await this.#archive.getResourceByUrl(urls);
				if (direct) {
					return resourceRowToLookupResult(direct);
				}
				// A miss may be an insert still queued — re-read serialized
				// behind the write queue so hit/miss is deterministic.
				const row = await this.#writeQueue.enqueue(() =>
					this.#archive.getResourceByUrl(urls),
				);
				return row ? resourceRowToLookupResult(row) : null;
			},
			// Let the crawler propagate the parent's source lineage to
			// sub-resources on `--resume` / `--retry-failed` sessions, where
			// `inventoryMode` is not in memory but the DB still remembers
			// the parent's `source`. Without this, sub-resources captured
			// during a re-render of an inventory-labelled page would fall
			// back to the DB DEFAULT `'crawled'` and lose their
			// `'inventory-discovered'` provenance.
			lookupPageSource: async (url) => this.#archive.getPageSourceByUrl(url),
			// Inventory mode is opted into by `CrawlerOrchestrator.inventory`;
			// the default crawl path stays in normal mode so new
			// rows continue to land in pages/resources with the DB DEFAULT
			// `'crawled'` provenance label.
			inventoryMode: options?.inventoryMode ?? null,
			// Forwarded as-is (including `undefined`) — `Crawler`'s own
			// constructor merges each against its `DEFAULT_NETWORK_OUTAGE_*`
			// constant, so omitting them here is exactly "use the default".
			networkOutageWindowMs: options?.networkOutageWindowMs,
			networkOutageErrorThreshold: options?.networkOutageErrorThreshold,
			networkOutageHostThreshold: options?.networkOutageHostThreshold,
			networkOutageProbeIntervalMs: options?.networkOutageProbeIntervalMs,
			networkProbe: options?.networkProbe ?? null,
			dedupeCap: options?.dedupeCap ?? null,
			dedupeMapCap: options?.dedupeMapCap,
			// Only the four resuming-session static methods
			// (`append`/`inventory`/`retryFailed`/`resume`) pass this — a
			// fresh `crawling()` has no archive history to seed from (see
			// `CrawlConfig.preloadedStickyShapeKeys`'s JSDoc).
			preloadedStickyShapeKeys: options?.preloadedStickyShapeKeys ?? [],
		});
	}

	/**
	 * Enables `await using orchestrator = ...`. Closes the archive (write
	 * or remove tmpDir + release the lock, per {@link Archive.close}) and
	 * then reaps any zombie Chromium processes via {@link garbageCollect} —
	 * the same two-step teardown every CLI crawl command previously
	 * repeated by hand in a `finally` block.
	 *
	 * Relays `Archive.close()`'s recovery-write progress (issue #294) as
	 * `recoveringArchiveWrite`/`writeStep`/`writeTarProgress` — the same
	 * events `write()` emits — for the rare case where the file doesn't
	 * exist on disk yet at dispose time (e.g. an explicit `write()` call
	 * threw partway through). A CLI listener whose display is still open at
	 * that point (it hadn't yet seen `writeFileEnd`) picks these up for
	 * free; one that already tore down after the earlier failure silently
	 * drops them, same as any other post-close display update.
	 */
	async [Symbol.asyncDispose](): Promise<void> {
		await this.#archive.close({
			onRecoveryStart: () => {
				void this.emit('recoveringArchiveWrite', {});
			},
			onStep: (step) => {
				void this.emit('writeStep', { step });
			},
			onTarProgress: (writtenBytes, totalBytes) => {
				void this.emit('writeTarProgress', { writtenBytes, totalBytes });
			},
		});
		this.garbageCollect();
	}

	/**
	 * Abort the current crawl operation.
	 *
	 * Delegates to the crawler's AbortController so that the dealer stops
	 * launching new workers. Currently running workers will finish, after
	 * which `deal()` resolves and `crawlEnd` is emitted normally.
	 */
	abort() {
		this.#crawler.abort();
	}

	/**
	 * Execute the crawl for the given list of URLs.
	 *
	 * Sets up event listeners on the crawler, starts crawling, and resolves
	 * when the crawl completes. Discovered pages, external pages, skipped pages,
	 * and resources are forwarded to the archive for storage.
	 *
	 * Safe to call more than once on the same instance —
	 * `#crawlUntilPendingClears` (issue #350) re-invokes this for each
	 * auto-retry attempt against the same long-lived `#crawler`. `Crawler`
	 * (`TypedAwaitEventEmitter`) has no listener-removal API, so a second
	 * call cannot replace the first call's listeners — it can only stack
	 * another set alongside them. Every listener this method attaches is
	 * instead guarded by a monotonic generation counter (`isCurrent()`,
	 * defined below): once a later call bumps it, every earlier call's
	 * listeners permanently fail the check and become inert no-ops, leaving
	 * exactly the latest call's listeners actually writing anything.
	 * @param list - The list of parsed URLs to crawl. May be empty when a resumed
	 *   session already has pending pages queued (for example `--retry-failed`).
	 * @param opts - Optional crawl overrides.
	 * @param opts.recursive - Whether discovered URLs are followed. Defaults to
	 *   `!fromList` (recursive unless the archive was created from a URL list), so
	 *   existing callers keep their behaviour; the retry flow passes it explicitly.
	 * @param opts.suppressFlushNotice - Skip emitting `flushingPendingWrites`
	 *   (issue #350). Set by `#crawlUntilPendingClears` for every auto-retry
	 *   attempt after the first: that event starts the CLI's crawl-tail
	 *   `TaskList` (`attach-crawl-display.ts`), which must stay closed until
	 *   the whole retry loop is done — a second `deal()`/`Lanes` cycle
	 *   starting while that `TaskList` is still open would corrupt the
	 *   display (see ARCHITECTURE.md's `Lanes`/`Display` single-instance
	 *   invariant). The write-queue drain itself is unaffected; only the
	 *   CLI-facing progress event is skipped.
	 * @param opts.isRetryContinuation - Forwarded to `Crawler#start()`
	 *   (issue #350). Set by `#crawlUntilPendingClears` for every auto-retry
	 *   attempt after the first, so `#runDeal` preserves cross-attempt
	 *   learned state (known-good hosts, outage-detector window) instead of
	 *   discarding it as if this were an unrelated fresh session.
	 * @returns A promise that resolves when crawling is complete.
	 */
	async crawling(
		list: ExURL[],
		opts?: {
			recursive?: boolean;
			suppressFlushNotice?: boolean;
			isRetryContinuation?: boolean;
		},
	) {
		const writeQueue = this.#writeQueue;
		// Per-session state, like `Crawler`'s own `#successfulHosts.clear()` /
		// `#networkGate.open()` reset at the start of `#runDeal` — a fresh
		// session must not inherit a dangling outage id from a prior one.
		this.#openNetworkOutageId = null;
		this.#openNetworkOutageStartedAt = null;
		// `Crawler` (`TypedAwaitEventEmitter`) has no listener-removal API, so
		// a second call on the same instance (an auto-retry attempt, issue
		// #350) cannot replace the first call's listeners — it can only add
		// another set alongside them. Every listener below is instead guarded
		// by `isCurrent()`, keyed off a monotonic generation counter bumped
		// here: once a later call starts, every earlier call's listeners
		// permanently fail this check and become inert no-ops (their
		// `writeQueue`/`#archive` side effects never run), leaving exactly
		// one "live" set — this call's — actually writing anything.
		const generation = ++this.#crawlGeneration;
		const isCurrent = () => generation === this.#crawlGeneration;
		// The ONLY way any listener below reaches `this.#crawler.on()` — a
		// structural guarantee (not a per-listener discipline a future edit
		// could forget) that no handler can run without the `isCurrent()`
		// check, however many are added here in the future.
		const registerGuarded = <T extends keyof CrawlerEventTypes>(
			event: T,
			handler: (payload: CrawlerEventTypes[T]) => void,
		): void => {
			this.#crawler.on(event, (payload) => {
				if (!isCurrent()) return;
				handler(payload);
			});
		};

		return new Promise<void>((resolve, reject) => {
			registerGuarded('error', (error) => {
				if (error.error instanceof PreloadShortCircuitError) {
					// DNS-burned host short-circuit: the underlying cause already
					// lives in `crawl_errors` from the original DNS failure.
					// Writing it again on every subsequent URL would amplify the
					// row count on each `--retry-failed` re-run and could even
					// inflate the preload selection on the next open. Drop it
					// here; `pages.status = -1` still gets set via the normal
					// scrape-error path (handleScrapeError → addPageError) so the
					// page record itself is unchanged.
					crawlerLog('Skipping addError for preload short-circuit: %s', error.url);
					return;
				}
				crawlerLog('On error: %O', error);
				writeQueue
					.enqueue(() => this.#archive.addError(error))
					.catch((writeError) => reject(writeError));
				void this.emit('error', error);
			});

			registerGuarded('page', ({ result, source, bodyHash }) => {
				writeQueue
					.enqueue(() => this.#archive.setPage(result, source, bodyHash))
					.catch((error) => reject(error));
			});

			registerGuarded('externalPage', ({ result, source }) => {
				writeQueue
					.enqueue(() => this.#archive.setExternalPage(result, source))
					.catch((error) => reject(error));
			});

			registerGuarded('skip', ({ url, reason, isExternal }) => {
				writeQueue
					.enqueue(() => this.#archive.setSkippedPage(url, reason, isExternal))
					.catch((error) => reject(error));
			});

			registerGuarded('pageError', ({ url, phase, message, isExternal }) => {
				writeQueue
					.enqueue(() => this.#archive.addPageError(url, phase, message, isExternal))
					.catch((error) => reject(error));
			});

			registerGuarded('redirect', ({ result, source }) => {
				writeQueue
					.enqueue(() => this.#archive.setRedirect(result, source))
					.catch((error) => reject(error));
				void this.emit('redirect', { result });
			});

			registerGuarded(
				'networkOutageConfirmed',
				({ startedAt, detectedAt, probeHost, triggerErrorCount, triggerHostCount }) => {
					crawlerLog(
						'Network outage confirmed: probeHost=%s triggerErrorCount=%d triggerHostCount=%d',
						probeHost,
						triggerErrorCount,
						triggerHostCount,
					);

					// Rare anomaly notice, printed unconditionally even though this
					// fires while `deal()`'s own crawl-time `Lanes` is actively
					// rendering (issue #294: unlike the crawl-tail notices reported
					// via the `crawlSessionNotice` event, this one has no
					// listener-based route available mid-crawl — visibility during
					// the outage takes priority over the display glitch this
					// causes).
					console.error(
						`[network] outage suspected — pausing workers (probe host: ${probeHost ?? 'none'})`,
					);
					writeQueue
						.enqueue(async () => {
							// Both fields are set together, inside this single
							// closure, so the pair can never fall out of sync
							// (e.g. one set synchronously above while the other
							// waits on the INSERT) — `networkOutageRecovered`'s
							// queued closure always sees either both set or
							// neither.
							const id = await this.#archive.insertNetworkOutage({
								startedAt,
								detectedAt,
								probeHost,
								triggerErrorCount,
								triggerHostCount,
							});
							this.#openNetworkOutageId = id;
							this.#openNetworkOutageStartedAt = startedAt;
						})
						.catch((error) => reject(error));
				},
			);

			registerGuarded('networkOutageRecovered', ({ endedAt }) => {
				// The `id` read is deferred to INSIDE the queued closure, not
				// read synchronously here, because `networkOutageConfirmed`'s
				// INSERT is itself only queued (not awaited) when that event
				// fires — `#openNetworkOutageId` is not guaranteed to be set
				// yet at the instant `networkOutageRecovered` fires (the two
				// events can arrive in quick succession, e.g. in tests that
				// drive them back-to-back with no real probe-interval delay
				// between them). `WriteQueue` runs enqueued operations in
				// submission order, so by the time THIS closure actually
				// executes, the confirm's INSERT closure (enqueued first) has
				// already completed and `#openNetworkOutageId` is reliably set.
				writeQueue
					.enqueue(() => {
						const id = this.#openNetworkOutageId;
						const startedAt = this.#openNetworkOutageStartedAt;
						if (id === null) {
							// Defensive: `networkOutageConfirmed` always
							// precedes `networkOutageRecovered` on the same
							// `Crawler` instance. If this fires anyway, there
							// is no row to close.
							crawlerLog('Network outage recovered but no open outage id was tracked');
							return Promise.resolve();
						}
						this.#openNetworkOutageId = null;
						this.#openNetworkOutageStartedAt = null;
						const durationMs = endedAt - (startedAt ?? endedAt);
						networkOutageSummaryCounter.confirmedCount++;
						networkOutageSummaryCounter.totalDurationMs += durationMs;
						crawlerLog('Network outage recovered: id=%d endedAt=%d', id, endedAt);
						// eslint-disable-next-line no-console -- see the confirmed handler above
						console.error(`[network] recovered after ${Math.round(durationMs / 1000)}s`);
						return this.#archive.closeNetworkOutage(id, endedAt);
					})
					.catch((error) => reject(error));
			});

			registerGuarded(
				'dedupeCap',
				({ shapeKey, sampleUrl, bodyHash, effectiveThreshold, observedCount }) => {
					crawlerLog(
						'Dedupe cap reached: shapeKey=%s effectiveThreshold=%d observedCount=%d',
						shapeKey,
						effectiveThreshold,
						observedCount,
					);
					console.error(
						`[dedupe-cap] same-cluster trap confirmed: ${shapeKey} (sample: ${sampleUrl})`,
					);
					writeQueue
						.enqueue(async () => {
							const id = await this.#archive.insertDedupeCapEvent({
								shapeKey,
								sampleUrl,
								bodyHash,
								effectiveThreshold,
								observedCount,
								detectedAt: Date.now(),
							});
							this.#dedupeCapEventIds.set(shapeKey, id);
						})
						.catch((error) => reject(error));
				},
			);

			registerGuarded('response', ({ resource, source }) => {
				writeQueue
					.enqueue(() => this.#archive.setResources(resource, source))
					.catch((error) => reject(error));
			});

			registerGuarded('responseReferrers', (resource) => {
				writeQueue
					.enqueue(() => this.#archive.setResourcesReferrers(resource))
					.catch((error) => reject(error));
			});

			registerGuarded('consoleLogs', ({ pageUrl, redirectPaths, entries }) => {
				writeQueue
					.enqueue(() => this.#archive.setConsoleLogs(pageUrl, redirectPaths, entries))
					.catch((error) => reject(error));
			});

			registerGuarded('crawlEnd', () => {
				// Read BEFORE enqueuing the dedupeCap-finalize closure below
				// (issue #294) so this reflects genuine backlog from the
				// crawl's own page/resource writes, not the finalize
				// closure's own, always-present entry.
				if (writeQueue.pending > 0 && !opts?.suppressFlushNotice) {
					void this.emit('flushingPendingWrites', { pending: writeQueue.pending });
				}
				// Deferred to INSIDE a queued closure, not read synchronously
				// here, for the same reason `networkOutageRecovered`'s handler
				// defers reading `#openNetworkOutageId`: a `dedupeCap` event's
				// INSERT closure may still be queued (not yet executed) at the
				// instant `crawlEnd` fires. `WriteQueue` runs enqueued
				// operations in submission order, so by the time THIS closure
				// executes, every earlier-queued `dedupeCap` INSERT has
				// already completed and `#dedupeCapEventIds` is reliably
				// populated.
				writeQueue
					.enqueue(async () => {
						const rejections = this.#crawler.getDedupeCapRejections();
						// Finalize every shape capped THIS session (has an id in
						// `#dedupeCapEventIds`), not just the ones with a nonzero
						// rejection count — a shape that capped near the end of the
						// crawl (or whose remaining anchors all happened to be
						// discovered before it capped) never enters `rejections` at
						// all, and would otherwise stay `rejected_count: NULL` forever
						// despite the crawl completing normally, corrupting the "NULL
						// means the crawl never reached crawlEnd" contract
						// `list-dedupe-cap-events.ts` documents.
						const shapeKeysToFinalize = new Set([
							...this.#dedupeCapEventIds.keys(),
							...rejections.keys(),
						]);
						await Promise.all(
							[...shapeKeysToFinalize].map((shapeKey) => {
								const rejectedCount = rejections.get(shapeKey) ?? 0;
								const id = this.#dedupeCapEventIds.get(shapeKey);
								// A shape capped THIS session has an id here (the
								// `dedupeCap` event always enqueues an INSERT before any
								// rejection for that shape can be counted) and is
								// finalized once via its row id. A shape with no id was
								// never observed this session at all — it was preloaded
								// into `DedupeCapTracker`'s sticky set from an EARLIER
								// session's `dedupe_cap_events` row (see
								// `CrawlConfig.preloadedStickyShapeKeys`'s JSDoc), so gate
								// rejections still accumulate for it but no new row (and
								// thus no id) is ever created. That earlier row's count is
								// accumulated onto by shape_key instead of overwritten.
								return id === undefined
									? this.#archive.accumulateDedupeCapRejectedCount(
											shapeKey,
											rejectedCount,
										)
									: this.#archive.finalizeDedupeCapEvent(id, rejectedCount);
							}),
						);
					})
					.catch((error) => reject(error));

				writeQueue
					.drain()
					.then(() => resolve())
					.catch((error) => reject(error));
			});

			this.#crawler.start(list, {
				recursive: opts?.recursive ?? !this.#fromList,
				isRetryContinuation: opts?.isRetryContinuation,
			});
		});
	}

	/**
	 * Kill any zombie Chromium processes that were not properly cleaned up.
	 *
	 * Retrieves the list of undead process IDs from the crawler and sends
	 * a SIGTERM signal to each one. Chromium is intentionally sent SIGTERM
	 * (not SIGKILL) to avoid leaving zombie processes.
	 */
	garbageCollect() {
		const pidList = this.getUndeadPid();
		log('Undead PIDs: %O', pidList);
		for (const pid of pidList) {
			try {
				log('Garbage collect: kill PID:%d', pid);
				// Chromium becomes a zombie process if SIGKILL signal.
				process.kill(pid);
			} catch (error) {
				log('Garbage collect: Failed killing PID:%d %O', pid, error);
			}
		}
	}
	/**
	 * Retrieve the list of process IDs for Chromium instances that are
	 * still running after crawling has ended.
	 * @returns An array of process IDs that should be terminated.
	 */
	getUndeadPid() {
		return this.#crawler.getUndeadPid();
	}
	/**
	 * Write the archive to its configured file path.
	 *
	 * The crawler's write path inserts directly into the 0.13 entity
	 * tables (`content_items` / `page_meta` / `anchor_edges` / …) during
	 * `crawling` / `append` / `resume` / `retryFailed` / `inventory`, so by
	 * the time `write()` is called those tables are already populated.
	 * This method just tars.
	 *
	 * Emits `writeFileStart` before writing and `writeFileEnd` after the
	 * write completes successfully. Also relays `Archive.write()`'s
	 * per-step (`writeStep`) and tar-byte (`writeTarProgress`) progress
	 * (issue #294) — tarring a 15 GB+ archive can take minutes, and without
	 * these events a CLI listener has no way to show it isn't hung.
	 */
	async write() {
		void this.emit('writeFileStart', { filePath: this.#archive.filePath });
		await this.#archive.write({
			onStep: (step) => {
				void this.emit('writeStep', { step });
			},
			onTarProgress: (writtenBytes, totalBytes) => {
				void this.emit('writeTarProgress', { writtenBytes, totalBytes });
			},
		});
		void this.emit('writeFileEnd', { filePath: this.#archive.filePath });
	}
	/**
	 * Releases the archive handle (lock dropped, tmpDir left intact — see
	 * {@link Archive.releaseHandle}) and throws a {@link PendingUrlsRemainError}
	 * (issue #350) describing why `#crawlUntilPendingClears` gave up. Typed
	 * to return `never` so callers can `return this.#abandonPendingRetryLoop(...)`
	 * and satisfy control-flow analysis without an unreachable trailing
	 * `throw`.
	 * @param params - See the matching {@link PendingUrlsRemainError} field for each property's meaning.
	 * @param params.pendingCount - Pending URL count at the moment of giving up.
	 * @param params.attemptsMade - Auto-retry attempts actually run before giving up.
	 * @param params.reason - See {@link PendingUrlsRemainError}'s `reason` field.
	 */
	async #abandonPendingRetryLoop(params: {
		pendingCount: number;
		attemptsMade: number;
		reason: PendingUrlsRemainReason;
	}): Promise<never> {
		const { pendingCount, attemptsMade, reason } = params;
		await this.#archive.releaseHandle();
		throw new PendingUrlsRemainError({
			pendingCount,
			attemptsMade,
			maxAutoRetry: this.#maxAutoRetry,
			reason,
			stubPath: this.#archive.tmpDir,
		});
	}

	/**
	 * Runs `crawling()` and, if the session ends with pages still pending
	 * (issue #350), automatically re-queues them and re-runs the crawl loop
	 * up to `#maxAutoRetry` times with an exponential backoff between
	 * attempts ({@link computeAutoRetryBackoffDelayMs}) before giving up.
	 *
	 * Every one of the six session-starting static factories
	 * (`crawling`/`append`/`inventory`/`recrawl`/`retryFailed`/`resume`)
	 * routes its first `crawling()` call through here instead of calling it
	 * directly, so that **a `.nitpicker` file existing on disk always
	 * implies `pending === 0`**: this method never lets a factory reach
	 * `orchestrator.write()` (called later by the CLI's post-crawl step)
	 * while pages remain unscraped. When retrying cannot (or should not)
	 * continue, it releases the archive handle — leaving the stub (tmpDir)
	 * on disk, un-packaged, lock released — and throws
	 * {@link PendingUrlsRemainError} so the operator can recover via
	 * `crawl --resume` or `--retry-failed`.
	 *
	 * Three conditions end the loop early, before `#maxAutoRetry` is reached:
	 * - The archive itself failed (`#archiveFailure` set by the constructor's
	 *   `Archive` `'error'` listener — a DB/storage-level failure). Retrying
	 *   scrape work cannot fix a broken database, so this re-throws the
	 *   original failure immediately without releasing-and-wrapping it in a
	 *   `PendingUrlsRemainError` — there is nothing "pending-remains"-shaped
	 *   about a storage failure.
	 * - The crawl was explicitly aborted (`#crawler.signal.aborted` — the
	 *   public `abort()` method, e.g. a caller-driven cancellation or a
	 *   Ctrl+C proxy in tests). `AbortController.signal` cannot be
	 *   un-aborted, so every subsequent `crawling()` call on this same
	 *   `#crawler` would deal zero work forever — retrying would just waste
	 *   one full backoff wait before "no progress" gives up anyway. This
	 *   returns immediately instead, matching this method's pre-#350
	 *   behaviour for an explicit abort: the caller gets the orchestrator
	 *   back with pending possibly `> 0` and decides for itself (the CLI's
	 *   own SIGINT handler never reaches this far — see `crawl.ts` — so the
	 *   `.nitpicker` ⟹ pending = 0 invariant still holds for that path). The
	 *   backoff wait itself is also abort-interruptible ({@link delayOrAbort}
	 *   rather than a bare `delay()`, issue #350 code review): a library
	 *   consumer calling `abort()` mid-wait (unlike the CLI's SIGINT path)
	 *   must not be stuck waiting up to 5 minutes for nothing.
	 * - An attempt makes no dent in the pending count (unchanged or grown):
	 *   burning the remaining budget against a cause retrying will not fix
	 *   (e.g. a wholesale host outage) just delays the operator finding out.
	 *   Checked AFTER the exhaustion check below it in the loop body so
	 *   that a final attempt which is both exhausted AND made no progress
	 *   reports as `'exhausted'` — the more actionable of the two (it tells
	 *   the operator the budget, not just that this one attempt stalled).
	 *
	 * Each retry attempt re-reads `getCrawlingState()` and
	 * `getResourceUrlList()` in full — the same cost `retryFailed`/`resume`/
	 * `append`/`inventory` already pay once per invocation, now paid up to
	 * `#maxAutoRetry` additional times (bounded, default 3). Retry attempts
	 * pass `isRetryContinuation: true` through to `Crawler#start()` so
	 * `#runDeal` preserves cross-attempt learned state (known-good hosts,
	 * network-outage detector window) instead of discarding it as if this
	 * were an unrelated fresh session (issue #350 code review) — the whole
	 * point of retrying is to avoid re-paying that detection cost.
	 * @param list - Forwarded to the first `crawling()` call.
	 * @param opts - Forwarded to the first `crawling()` call.
	 * @param opts.recursive
	 */
	async #crawlUntilPendingClears(
		list: ExURL[],
		opts?: { recursive?: boolean },
	): Promise<void> {
		await this.crawling(list, opts);
		if (this.#archiveFailure) {
			throw this.#archiveFailure;
		}
		if (this.#crawler.signal.aborted) {
			return;
		}

		// Fetched at most once across the whole retry loop (issue #350 code
		// review), not per attempt: `getResourceUrlList()` is a full scan of
		// every known resource URL, but `Crawler#resume()`'s use of it is
		// just seeding the in-memory `#resources` Set — idempotent, and
		// already kept current independently as the live crawl writes new
		// resources during each attempt. Re-fetching the full list on every
		// attempt would re-pay that scan cost for no benefit on a large
		// archive. `undefined` until the first retry actually needs it, so
		// the common case (pending clears without ever retrying) never
		// fetches it at all.
		let cachedResources: string[] | undefined;

		let previousPendingCount: number | null = null;
		for (let attempt = 1; ; attempt++) {
			const { scraped, pending } = await this.#archive.getCrawlingState();
			if (pending.length === 0) {
				return;
			}
			if (attempt > this.#maxAutoRetry) {
				return this.#abandonPendingRetryLoop({
					pendingCount: pending.length,
					attemptsMade: attempt - 1,
					reason: 'exhausted',
				});
			}
			if (previousPendingCount !== null && pending.length >= previousPendingCount) {
				return this.#abandonPendingRetryLoop({
					pendingCount: pending.length,
					attemptsMade: attempt - 1,
					reason: 'no-progress',
				});
			}
			previousPendingCount = pending.length;

			const delayMs = computeAutoRetryBackoffDelayMs(attempt);
			void this.emit('autoRetryWaiting', {
				attempt,
				maxAttempts: this.#maxAutoRetry,
				pendingCount: pending.length,
				delayMs,
			});
			// Printed unconditionally, mirroring `networkOutageConfirmed`'s
			// rationale above: this always fires in the gap after `deal()`'s
			// Lanes has closed and before the next one starts (the retry's
			// own `crawling()` call hasn't run yet), so there is no active
			// display to corrupt.
			// eslint-disable-next-line no-console -- see comment above
			console.error(
				`[auto-retry] ${pending.length} pending page(s) remain — waiting ${Math.round(delayMs / 1000)}s before retry ${attempt}/${this.#maxAutoRetry}`,
			);
			await delayOrAbort(delayMs, this.#crawler.signal);
			if (this.#crawler.signal.aborted) {
				return;
			}

			cachedResources ??= await this.#archive.getResourceUrlList();
			const pagesScrapedOffset = await this.#archive.getScrapedHtmlPageCount();
			this.#crawler.resume(pending, scraped, cachedResources, pagesScrapedOffset);
			await this.crawling([], {
				recursive: false,
				suppressFlushNotice: true,
				isRetryContinuation: true,
			});
			if (this.#archiveFailure) {
				throw this.#archiveFailure;
			}
			if (this.#crawler.signal.aborted) {
				return;
			}
		}
	}

	/**
	 * Assign natural URL sort order to every internal page, relaying chunk
	 * progress through the `sortingUrls` event (issue #294). Always runs
	 * after `crawling()` has returned, i.e. once `initializedCallback` has
	 * already had a chance to attach listeners — unlike the setup-phase
	 * work in `append`/`inventory`/`retryFailed`, this has an orchestrator
	 * instance to emit from, so it goes through the event emitter rather
	 * than a `SetupProgressCallbacks` callback.
	 */
	async #setUrlOrder() {
		await this.#archive.setUrlOrder((processed, total) => {
			void this.emit('sortingUrls', { processed, total });
		});
	}

	/**
	 * Create a new CrawlerOrchestrator instance and start crawling the given URLs.
	 *
	 * This is the primary factory method for starting a fresh crawl. It:
	 * 1. Parses and sorts the input URLs
	 * 2. Creates an archive file
	 * 3. Saves the crawl configuration
	 * 4. Runs the optional initialized callback
	 * 5. Executes the crawl
	 * 6. Sorts the archived URLs in natural order
	 * @param url - One or more URL strings to crawl.
	 * @param options - Optional configuration overrides for the crawl session.
	 * @param initializedCallback - Optional callback invoked after initialization but before crawling starts.
	 * @returns A promise that resolves to the CrawlerOrchestrator instance after crawling completes.
	 * @throws {Error} If the URL list is empty or contains no valid URLs.
	 * @throws {PendingUrlsRemainError} When the crawl session ends with pages still pending after exhausting auto-retry.
	 */
	static async crawling(
		url: string[],
		options?: Partial<CrawlConfig>,
		initializedCallback?: CrawlInitializedCallback,
	) {
		const list = sortUrl(url, options);
		const urlParsed = list[0];

		if (!urlParsed) {
			throw new Error('URL is empty');
		}

		const cwd = options?.cwd ?? process.cwd();
		const filePath = options?.filePath
			? resolveOutputPath(options.filePath, cwd)
			: Archive.joinPath(
					cwd,
					`${urlParsed.hostname}-${Archive.timestamp()}.${Archive.FILE_EXTENSION}`,
				);
		const fileName =
			path.basename(filePath, `.${Archive.FILE_EXTENSION}`) || path.basename(filePath);
		const disableQueries = options?.disableQueries || false;
		const defaultUserAgent = `Nitpicker/${pkg.version}`;
		const archive = await Archive.create({ filePath, cwd, disableQueries });

		// Each positional URL is both a starting point and a scope entry.
		const rootHrefs = list.map((u) => u.withoutHash);

		await archive.setConfig({
			// `version` is the archive-format version (see
			// `assertCompatibleVersion`), NOT the npm package version. Decoupled
			// because format-breaking changes and code-release cadence are
			// different concerns — a patch release must not silently bump the
			// format version and reject older archives, and a dev build of an
			// unreleased breaking change must be able to produce archives the
			// same build can read back.
			version: REQUIRED_FORMAT_VERSION,
			name: fileName,
			baseUrl: rootHrefs[0]!,
			roots: rootHrefs,
			recursive: options?.recursive ?? true,
			fetchExternal: options?.fetchExternal ?? true,
			image: options?.image ?? true,
			interval: options?.interval || 0,
			parallels: options?.parallels || 0,
			excludes: normalizeToArray(options?.excludes),
			excludeKeywords: normalizeToArray(options?.excludeKeywords),
			excludeUrls: [
				...DEFAULT_EXCLUDED_EXTERNAL_URLS,
				...normalizeToArray(options?.excludeUrls),
			],
			maxExcludedDepth: options?.maxExcludedDepth || 10,
			retry: options?.retry ?? 3,
			fromList: !!options?.list,
			disableQueries,
			userAgent: options?.userAgent || defaultUserAgent,
			ignoreRobots: options?.ignoreRobots ?? false,
			mainContentSelector: options?.mainContentSelector ?? null,
			...buildCreatedCwdPatch(cwd),
		});
		const orchestrator = new CrawlerOrchestrator(archive, {
			...options,
			roots: rootHrefs,
		});
		const config = await archive.getConfig();
		if (initializedCallback) {
			await initializedCallback(orchestrator, config);
		}
		log('Start crawling');
		log(
			'URL %O',
			list.map((url) => url.href),
		);
		log('Config %O', config);
		await orchestrator.#crawlUntilPendingClears(list);
		log('Crawling completed');
		CrawlerOrchestrator.#finalizeCrawlSession(orchestrator);
		log('Set order natural URL sort');
		await orchestrator.#setUrlOrder();
		log('Sorting done');
		return orchestrator;
	}

	/**
	 * Append a fresh crawl to an existing `.nitpicker` archive.
	 *
	 * The given `newUrls` become additional recursive roots: their `withoutHash`
	 * form is merged into `info.roots` and the crawler picks them up as
	 * starting URLs. Previously-external pages whose URL now falls under
	 * the expanded scope are demoted back to "needs scraping" so the next pass
	 * re-fetches them as full internal pages. A `<archive>.bak` is created
	 * before the crawl and removed on success; if the crawl throws, the backup
	 * is restored to keep the original archive intact — except when the crawl
	 * ends with {@link PendingUrlsRemainError} (issue #350), where the
	 * un-packaged stub itself is the recovery path and the backup is instead
	 * left untouched (deleted, not restored — see
	 * {@link CrawlerOrchestrator.#abandonBackupOnPendingRemains}).
	 *
	 * List-mode archives (`info.fromList === true`) are rejected because their
	 * pages are all metadata-only and cannot host a recursive append.
	 * @param archivePath - Absolute or relative path to the existing `.nitpicker`.
	 * @param newUrls - New root URLs to add and crawl.
	 * @param options - Optional config overrides applied on top of the archived config.
	 * @param initializedCallback - Optional callback invoked after initialization but before crawling resumes.
	 * @param setupProgress - Optional progress callbacks for the setup phase
	 *   (untar, `.bak` copy, repromote, state rebuild) that runs before
	 *   `initializedCallback` — see {@link SetupProgressCallbacks} for why
	 *   this can't go through the orchestrator's event emitter (issue #294).
	 * @returns The orchestrator instance after the append crawl completes.
	 * @throws {Error} When `newUrls` is empty, the archive is in list mode, or it cannot be parsed.
	 * @throws {PendingUrlsRemainError} When the crawl session ends with pages still pending after exhausting auto-retry.
	 */
	static async append(
		archivePath: string,
		newUrls: string[],
		options?: Partial<CrawlConfig>,
		initializedCallback?: CrawlInitializedCallback,
		setupProgress?: SetupProgressCallbacks,
	) {
		const [
			PHASE_EXTRACTING,
			PHASE_LOADING_CONFIG,
			PHASE_BACKING_UP,
			PHASE_REPROMOTING,
			PHASE_LOADING_DEDUPE_KEYS,
			PHASE_LOADING_CRAWL_STATE,
			PHASE_LOADING_RESOURCES,
			PHASE_LOADING_SCRAPED_COUNT,
			PHASE_RESTORING_CRAWL_STATE,
		] = APPEND_SETUP_PHASES;
		if (newUrls.length === 0) {
			throw new Error('append: newUrls is empty');
		}
		const cwd = options?.cwd ?? process.cwd();
		const absFilePath = path.isAbsolute(archivePath)
			? archivePath
			: path.resolve(cwd, archivePath);

		// See `ArchiveOpenOptions.openPluginData` for why this must be `true`
		// on every writer path that calls `write()`.
		setupProgress?.onPhase?.(PHASE_EXTRACTING);
		const archive = await Archive.open({
			filePath: absFilePath,
			cwd,
			openPluginData: true,
			onExtractProgress: setupProgress?.onExtractProgress,
			onLog: setupProgress?.onLog,
		});
		// Any throw between here and the successful return must release the
		// archive lock and clean up tmpDir; the caller's `close()` only runs on
		// the happy path. Errors from `close()` itself are intentionally
		// best-effort: the original error is what matters.
		try {
			setupProgress?.onPhase?.(PHASE_LOADING_CONFIG);
			const archived = await archive.getConfig();
			if (archived.fromList) {
				throw new Error(
					'Cannot append to a list-mode archive: this archive was created with --list/--list-file and contains metadata-only pages. Create a fresh archive instead.',
				);
			}

			const newParsed = sortUrl(newUrls, archived);
			if (newParsed.length === 0) {
				throw new Error('append: no parseable URLs provided');
			}
			const newRoots = newParsed.map((u) => u.withoutHash);
			const mergedRoots = [...new Set([...archived.roots, ...newRoots])];
			const mergedConfig: Config = {
				...archived,
				...cleanObject(options),
				roots: mergedRoots,
				fromList: false,
				recursive: true,
				baseUrl: mergedRoots[0]!,
				// Stamped for `Archive.resume` (issue #350) — this session's
				// cwd, not `options.cwd` (already spread above and dropped by
				// `updateConfig`'s allowlist): a stub left behind by THIS
				// append should resume back to where THIS command ran, not
				// wherever the original crawl happened to run from.
				...buildCreatedCwdPatch(cwd),
			};

			const backupPath = absFilePath + '.bak';
			setupProgress?.onPhase?.(PHASE_BACKING_UP);
			await copyFileWithProgress(absFilePath, backupPath, setupProgress?.onCopyProgress);

			try {
				await archive.updateConfig(mergedConfig);

				const scopeMap = new Map<string, ExURL[]>();
				for (const raw of mergedRoots) {
					const parsed = parseUrl(raw, archived);
					if (!parsed) continue;
					const existing = scopeMap.get(parsed.hostname) ?? [];
					scopeMap.set(parsed.hostname, [...existing, parsed]);
				}
				setupProgress?.onPhase?.(PHASE_REPROMOTING);
				await archive.repromoteExternalPages(
					scopeMap,
					archived,
					setupProgress?.onChunkProgress,
				);

				// Seed the sticky set from prior sessions' confirmed traps so
				// `--append` does not pay the cost of re-discovering them (see
				// `DedupeCapTracker`'s constructor JSDoc).
				setupProgress?.onPhase?.(PHASE_LOADING_DEDUPE_KEYS);
				const preloadedStickyShapeKeys = await archive.listDedupeCapShapeKeys();
				const orchestrator = new CrawlerOrchestrator(archive, {
					...mergedConfig,
					roots: mergedRoots,
					preloadedStickyShapeKeys,
				});
				setupProgress?.onPhase?.(PHASE_LOADING_CRAWL_STATE);
				const { scraped, pending } = await archive.getCrawlingState();
				setupProgress?.onPhase?.(PHASE_LOADING_RESOURCES);
				const resources = await archive.getResourceUrlList(
					setupProgress?.onChunkProgress,
				);
				setupProgress?.onPhase?.(PHASE_LOADING_SCRAPED_COUNT);
				const pagesScrapedOffset = await archive.getScrapedHtmlPageCount();
				setupProgress?.onPhase?.(PHASE_RESTORING_CRAWL_STATE);
				orchestrator.#crawler.resume(pending, scraped, resources, pagesScrapedOffset);
				if (initializedCallback) {
					await initializedCallback(orchestrator, mergedConfig);
				}
				log('Start appending');
				log('Archive %s', absFilePath);
				log('New roots %O', newRoots);
				log('Merged roots %O', mergedRoots);
				await CrawlerOrchestrator.#preloadDnsBurnedHostCache(archive);
				await orchestrator.#crawlUntilPendingClears(newParsed);
				CrawlerOrchestrator.#finalizeCrawlSession(orchestrator);
				await orchestrator.#setUrlOrder();
				await ignoreEnoent(unlinkFile(backupPath));
				return orchestrator;
			} catch (error) {
				if (error instanceof PendingUrlsRemainError) {
					await CrawlerOrchestrator.#abandonBackupOnPendingRemains(
						setupProgress,
						backupPath,
					);
					throw error;
				}
				try {
					setupProgress?.onPhase?.(RECOVERY_RESTORE_FROM_BACKUP);
					await copyFileWithProgress(
						backupPath,
						absFilePath,
						setupProgress?.onCopyProgress,
					);
					await ignoreEnoent(unlinkFile(backupPath));
				} catch (restoreError) {
					// Restore itself failed — surface both so the operator knows
					// the .bak still exists and the original archive may be
					// corrupt. The outer `catch` still releases the lock.
					throw new AggregateError(
						[error, restoreError],
						`append failed AND restore from backup failed. Original archive backup is left at: ${backupPath}`,
					);
				}
				throw error;
			}
		} catch (error) {
			await archive.close().catch(() => {});
			throw error;
		}
	}

	/**
	 * Inventory mode: cross-reference a user-supplied URL list against an
	 * existing `.nitpicker` archive and import ONLY the URLs that are not yet
	 * tracked there. Designed to surface "orphan" landing pages that link
	 * graph traversal could not reach, and "unused" server-side files that
	 * no crawled page references — both of which the
	 * `listIsolatedPages` / `listUnusedResources` queries can then list.
	 *
	 * Flow:
	 *
	 * 1. Open the archive (writer mode, takes the archive lock).
	 * 2. Reject list-mode archives — they hold metadata-only rows that
	 *    inventory has no business touching.
	 * 3. Warn (but proceed) on archives with unfinished `pending` URLs —
	 *    crawled-wins source priority keeps their labels stable; the
	 *    operator can `--resume` first if they want the prior work
	 *    finalized.
	 * 4. If `source` is given, archive its exact bytes under
	 *    `inventory/<sha256>.txt` (see {@link Archive.saveInventorySourceList}).
	 *    Done before scope classification so even a run that discards every
	 *    URL (out of scope or already known) still leaves a recoverable
	 *    copy of what was fed in.
	 * 5. Parse the URL list — the CLI has already warned-and-dropped
	 *    unparseable-URL lines before calling this method, so every
	 *    remaining entry parses. Anything outside the archived scope is
	 *    warned and skipped (inventory is per-server by design).
	 * 6. Subtract URLs that already exist in `pages` or `resources` so the
	 *    second (and N-th) inventory pass is a no-op for known rows — keeps
	 *    `'inventory-seed'` rows from being silently demoted.
	 * 7. Split the remaining novel URLs on the effective `excludes` /
	 *    `excludeUrls` (archived config overlaid with this run's
	 *    overrides — the same inputs the crawl's fetch-time
	 *    `shouldSkipUrl` gate uses). Matching URLs are recorded as
	 *    terminal skipped pages (`is_skipped=1`,
	 *    `skip_reason='excluded'`, `source='inventory-seed'`) instead of
	 *    being imported — the same end state a link-discovered excluded
	 *    URL reaches in a normal crawl — and counted as
	 *    `exclude_skipped` (issue #260). Running this after step 6 keeps
	 *    previously crawled rows that newly match the exclusion config
	 *    untouched (crawled-wins). `excludeKeywords` does not
	 *    participate here: it matches rendered page content, which a URL
	 *    list does not have — HTML seeds still get it at render time via
	 *    the browser verdict.
	 * 8. Make `<archive>.bak`. Anything thrown beyond this point restores
	 *    from the backup.
	 * 9. Classify each importable novel URL by URL-extension heuristic
	 *    (no probe — see the in-body rationale). HTML-looking URLs are
	 *    queued as Crawler seeds (`'inventory-seed'`); everything else is
	 *    recorded in `resources` directly as `'inventory-seed'` (no
	 *    browser launch, no HEAD).
	 * 10. If any HTML seeds exist, start a Crawler with
	 *    `inventoryMode = { seedUrls }` so the rendered page and every newly
	 *    discovered downstream link is labelled correctly. `resume` is fed
	 *    the existing `scraped` / `resources` sets so links into already-
	 *    crawled pages stop at the seen-gate without re-rendering.
	 * 11. Drop the backup on success; restore it on any throw.
	 *
	 * Mutually exclusive with `--append` / `--retry-failed` / `--resume` /
	 * `--diff` / `--list` / `--list-file` / `--single` / `--output` — the
	 * CLI dispatch enforces this; this method assumes the caller honoured
	 * the contract.
	 * @param archivePath - Absolute or cwd-relative path to the `.nitpicker` archive.
	 * @param inventoryUrls - Pre-read URL list (one URL per element).
	 * @param options - Optional config overrides — most callers leave this blank and let the archived config flow through.
	 * @param initializedCallback - Hook invoked once the orchestrator is constructed but before `crawling` runs (the CLI uses it to attach progress reporting).
	 * @param source - The CLI's already-read source list, as `{ sha256, bytes }`.
	 *   The orchestrator deliberately does NOT receive the file path: the
	 *   path is privacy-sensitive (leaks user-home / OS structure when
	 *   archives are shared) and we want it lifted off this boundary so no
	 *   future log line / breadcrumb / error message inside the orchestrator
	 *   can accidentally re-leak it. `bytes` is archived verbatim under
	 *   `inventory/<sha256>.txt` (see {@link Archive.saveInventorySourceList})
	 *   before scope classification, so a later `--inventory` run against
	 *   the same list is an audit no-op even when it discards zero new
	 *   URLs. Pass `null` for programmatic callers that built
	 *   `inventoryUrls` in-memory; the audit row's `source_file_sha256`
	 *   column will be `NULL` and no source list is archived.
	 * @param setupProgress - Optional progress callbacks for the setup phase
	 *   (untar, scope classification, bulk inserts, state rebuild) that runs
	 *   before `initializedCallback` — see {@link SetupProgressCallbacks} for
	 *   why this can't go through the orchestrator's event emitter (issue
	 *   #294).
	 * @returns The orchestrator instance after a successful inventory pass.
	 * @throws {Error} When `inventoryUrls` is empty or the archive is in list mode. Unresolved pending URLs from a previous crawl do NOT throw — see step 3.
	 * @throws {PendingUrlsRemainError} When the crawl session ends with pages still pending after exhausting auto-retry.
	 */
	static async inventory(
		archivePath: string,
		inventoryUrls: string[],
		options?: Partial<CrawlConfig>,
		initializedCallback?: CrawlInitializedCallback,
		source: InventorySource | null = null,
		setupProgress?: SetupProgressCallbacks,
	) {
		const [
			PHASE_EXTRACTING,
			PHASE_LOADING_CONFIG,
			PHASE_LOADING_CRAWL_STATE_PRE,
			PHASE_CHECKING_KNOWN_URLS,
			PHASE_BACKING_UP,
			PHASE_RECORDING_NON_HTML,
			PHASE_RECORDING_HTML_SEEDS,
			PHASE_RECORDING_EXCLUDED,
			PHASE_LOADING_CRAWL_STATE_POST,
			PHASE_LOADING_RESOURCES,
			PHASE_LOADING_SCRAPED_COUNT,
			PHASE_RESTORING_CRAWL_STATE,
		] = INVENTORY_SETUP_PHASES;
		if (inventoryUrls.length === 0) {
			throw new Error('inventory: URL list is empty');
		}
		const cwd = options?.cwd ?? process.cwd();
		const absFilePath = path.isAbsolute(archivePath)
			? archivePath
			: path.resolve(cwd, archivePath);

		// See `ArchiveOpenOptions.openPluginData` for why this must be `true`
		// on every writer path that calls `write()`.
		setupProgress?.onPhase?.(PHASE_EXTRACTING);
		const archive = await Archive.open({
			filePath: absFilePath,
			cwd,
			openPluginData: true,
			onExtractProgress: setupProgress?.onExtractProgress,
			onLog: setupProgress?.onLog,
		});
		try {
			setupProgress?.onPhase?.(PHASE_LOADING_CONFIG);
			const archived = await archive.getConfig();
			if (archived.fromList) {
				throw new Error(
					'Cannot run inventory on a list-mode archive: this archive was created with --list/--list-file and contains metadata-only pages. Create a fresh archive instead.',
				);
			}
			// Stamped for `Archive.resume` (issue #350) — a stub left behind
			// by THIS inventory run should resume back to where THIS command
			// ran, independent of `--resume`'s own invocation directory.
			await archive.updateConfig(buildCreatedCwdPatch(cwd));

			setupProgress?.onPhase?.(PHASE_LOADING_CRAWL_STATE_PRE);
			const { pending } = await archive.getCrawlingState();
			if (pending.length > 0) {
				// `getCrawlingState` returns the STRICT pending set — in-scope,
				// anchor-referenced, `scraped=0` rows. Predicted-discard leaks
				// and external anomalies are filtered out at the reader, so a
				// non-empty pending here means the previous session genuinely
				// stopped with interrupted in-scope work. A hard rejection is
				// still not warranted (with a looser reader it would block
				// legitimate inventory runs whenever leak rows polluted the
				// count), so a warning is
				// enough — the inventory pass continues and the crawled-wins
				// source priority keeps stale labels stable even if some of
				// the strict-pending rows happen to land on inventory seeds.
				//
				// Routed through `setupProgress.onLog` (issue #294 code
				// review), not a bare `console.warn`: the `'Loading crawl
				// state'` row is active at this exact point (`onPhase` just
				// above), and a direct stream write here corrupts the setup
				// `TaskList`'s cursor tracking the same way self-healing
				// migration notices did. `onLog` sets this row's message,
				// which then freezes as its permanent `done` text once the
				// next `onPhase` call moves past it — still visible in the
				// final terminal output, just not printed as its own
				// interrupting line. Falls back to `console.warn` under
				// `--silent` (`setupProgress` is `null` there, so there is no
				// row to set this on, and the warning would otherwise never
				// surface at all).
				const message = `inventory: archive has ${pending.length} pending URLs from a previous crawl. Proceeding — crawled-wins priority keeps their labels stable. Consider \`--resume\` first if you want the prior work finalized.`;
				if (setupProgress?.onLog) {
					setupProgress.onLog(message);
				} else {
					// eslint-disable-next-line no-console -- --silent has no TaskList row to report through
					console.warn(message);
				}
			}

			// Archive the exact source bytes before scope classification, so
			// even a run that discards every URL (out-of-scope or already
			// known — see `novelUrls.length === 0` below) still leaves a
			// recoverable copy of what was fed in. Content-hash-named, so a
			// second `--inventory` pass with the same list is a no-op write.
			if (source) {
				await archive.saveInventorySourceList(source.sha256, source.bytes);
			}

			// Parse, scope-classify, and split the candidate URLs into
			// already-known vs. novel — shared with `recrawl`, see
			// `#classifyInventoryCandidateUrls`.
			setupProgress?.onPhase?.(PHASE_CHECKING_KNOWN_URLS);
			const { outOfScope, novelUrls } =
				await CrawlerOrchestrator.#classifyInventoryCandidateUrls(
					inventoryUrls,
					archived,
					archive,
				);

			// Split the novel URLs on the exclusion config — shared with
			// `recrawl`, see `#classifyExcludedNovelUrls`. `effectiveConfig`
			// is also used below to build `baseConfig`.
			const effectiveConfig = { ...archived, ...cleanObject(options) };
			const { excludedNovelUrls, importableNovelUrls } =
				CrawlerOrchestrator.#classifyExcludedNovelUrls(novelUrls, effectiveConfig);

			if (novelUrls.length === 0) {
				// Nothing to do — release the archive cleanly without taking a
				// backup. The orchestrator returned here is empty; the caller
				// should only invoke `close` on it. `effectiveConfig` is the
				// same archived-plus-overrides merge every other path in this
				// method sees.
				const orchestrator = new CrawlerOrchestrator(archive, effectiveConfig);
				if (initializedCallback) {
					await initializedCallback(orchestrator, effectiveConfig);
				}
				return orchestrator;
			}

			const backupPath = absFilePath + '.bak';
			setupProgress?.onPhase?.(PHASE_BACKING_UP);
			await copyFileWithProgress(absFilePath, backupPath, setupProgress?.onCopyProgress);

			// Ingestion (pre-insert + audit) is `.bak`-protected — a failure
			// there restores the archive and the operator reruns. Once
			// ingestion completes and the `.bak` is released, the scrape
			// phase runs without `.bak` protection: a Ctrl+C / crash leaves
			// the pre-inserted `inventory-seed` rows in `pages` so
			// `crawl --resume` recovers them via the strict-pending set
			// (see {@link Database.getCrawlingState}'s `OR p.source != 'crawled'`
			// clause). This flag steers the catch below.
			let ingestionComplete = false;
			try {
				// Classify, dedup, and bulk-record the novel URLs — shared
				// with `recrawl`, see `#ingestNovelSeeds`.
				const { htmlSeeds, nonHtmlSeeds } = await CrawlerOrchestrator.#ingestNovelSeeds({
					archive,
					importableNovelUrls,
					excludedNovelUrls,
					setupProgress,
					phaseRecordingNonHtml: PHASE_RECORDING_NON_HTML,
					phaseRecordingHtmlSeeds: PHASE_RECORDING_HTML_SEEDS,
					phaseRecordingExcluded: PHASE_RECORDING_EXCLUDED,
				});
				// Audit row is written *inside* the `.bak` window: a libsql
				// hiccup or transient lock on the INSERT aborts the ingestion
				// and the `.bak` restore wipes the pre-inserted seeds too,
				// so "either the whole run took or none of it did" holds at
				// the ingestion boundary. Audit failures are deliberately
				// NOT swallowed — inside the `.bak` window a restore is
				// safe and useful (see
				// {@link CrawlerOrchestrator.#writeListReconcileRunRow}).
				await CrawlerOrchestrator.#writeListReconcileRunRow(archive, {
					inventoryUrlsCount: inventoryUrls.length,
					htmlSeedsCount: htmlSeeds.length,
					nonHtmlCount: nonHtmlSeeds.length,
					outOfScope,
					excludeSkipped: excludedNovelUrls.length,
					sourceFileSha256: source?.sha256 ?? null,
					invalidSkipped: source?.invalidLineCount ?? null,
				});
				// Ingestion's DB writes are now committed. From here on a
				// throw must NOT trigger the `.bak` restore (it would wipe
				// the durable seeds + audit row). Setting the flag *before*
				// the `.bak` unlink covers the rare Windows / antivirus
				// path where `unlinkFile` itself fails with EBUSY/EPERM —
				// the `.bak` may leak on disk for the operator to delete
				// manually, but the archive state stays intact.
				ingestionComplete = true;
				// Release `.bak` — ingestion succeeded. Beyond this point a
				// throw is the scrape phase's problem; the archive stays
				// intact and the operator runs `--resume` to recover.
				await ignoreEnoent(unlinkFile(backupPath));

				// Config sent to the user-facing `initializedCallback`
				// (matches the rest of the orchestrator's public surface —
				// no inventory bookkeeping leaks out).
				const baseConfig: Config = {
					...effectiveConfig,
					recursive: true,
					fromList: false,
				};
				const seedSet = new Set(htmlSeeds.map((u) => u.withoutHashAndAuth));
				// CrawlConfig overlay handed to the orchestrator constructor —
				// carries the runtime-only `inventoryMode` that drives source
				// labelling. Not persisted to the archive.
				const orchestratorOptions: Partial<CrawlConfig> = {
					...baseConfig,
					inventoryMode: { seedUrls: seedSet },
				};
				if (htmlSeeds.length > 0) {
					// Seed the sticky set from prior sessions' confirmed traps
					// so `--inventory` does not pay the cost of
					// re-discovering them (see `DedupeCapTracker`'s
					// constructor JSDoc). Scoped to this branch only,
					// matching `#preloadDnsBurnedHostCache`'s scoping below —
					// the fallback (non-HTML-only) branch never calls
					// `orchestrator.crawling(...)`, so the tracker is never
					// consulted there.
					orchestratorOptions.preloadedStickyShapeKeys =
						await archive.listDedupeCapShapeKeys();
					const orchestrator = new CrawlerOrchestrator(archive, orchestratorOptions);
					// Re-read pending *after* the pre-insert so the strict-
					// pending set includes the freshly inserted
					// `inventory-seed` rows; feed that into `crawler.resume`
					// and start a seedless `crawling([])` — the same pattern
					// `retryFailed` uses to drive the dealer from the
					// pending set alone (see retryFailed's
					// `crawling([], { recursive })` invocation).
					setupProgress?.onPhase?.(PHASE_LOADING_CRAWL_STATE_POST);
					const { scraped: scrapedAfter, pending: pendingAfter } =
						await archive.getCrawlingState();
					setupProgress?.onPhase?.(PHASE_LOADING_RESOURCES);
					const resources = await archive.getResourceUrlList(
						setupProgress?.onChunkProgress,
					);
					// Pre-existing rendered HTML page count seeds the
					// session-spanning `pagesScraped` counter so the progress
					// header reads `internalDone(cumulative pagesScraped)`
					// rather than session-only — matches the `append` /
					// `retryFailed` / `resume` paths and avoids users reading
					// the parenthesised number as "inner pages dropped to N".
					setupProgress?.onPhase?.(PHASE_LOADING_SCRAPED_COUNT);
					const pagesScrapedOffset = await archive.getScrapedHtmlPageCount();
					setupProgress?.onPhase?.(PHASE_RESTORING_CRAWL_STATE);
					orchestrator.#crawler.resume(
						pendingAfter,
						scrapedAfter,
						resources,
						pagesScrapedOffset,
					);
					if (initializedCallback) {
						await initializedCallback(orchestrator, baseConfig);
					}
					log('Start inventory');
					log('Archive %s', absFilePath);
					log(
						'HTML seeds %O',
						htmlSeeds.map((u) => u.href),
					);
					await CrawlerOrchestrator.#preloadDnsBurnedHostCache(archive);
					await orchestrator.#crawlUntilPendingClears([], { recursive: true });
					CrawlerOrchestrator.#finalizeCrawlSession(orchestrator);
					await orchestrator.#setUrlOrder();
					return orchestrator;
				}

				// Only non-HTML URLs were imported — nothing left to render,
				// but still update sort order and finalize.
				const orchestrator = new CrawlerOrchestrator(archive, orchestratorOptions);
				if (initializedCallback) {
					await initializedCallback(orchestrator, baseConfig);
				}
				await orchestrator.#setUrlOrder();
				return orchestrator;
			} catch (error) {
				if (ingestionComplete) {
					// Scrape phase failed — either the auto-retry loop
					// (`#crawlUntilPendingClears`, issue #350) gave up with
					// pages still pending, or some other exception. Either
					// way the pre-inserted seeds + audit row are durable
					// inside `tmpDir/db.sqlite` but must NOT be packaged: a
					// `.nitpicker` on disk must imply `pending === 0` (see
					// that method's JSDoc). The outer catch below runs
					// `archive.close()`, which sees the original
					// (pre-inventory) `.nitpicker` already on disk and
					// would just `remove(tmpDir)` — silently wiping every
					// `inventory-seed` row and the audit row.
					//
					// Release the handle ourselves (leaving tmpDir intact)
					// before letting the outer catch unwind, then re-throw
					// so the operator learns about the scrape failure and
					// can recover via `crawl --resume <stub>`. `releaseHandle`
					// shares the orchestrator's `#closeOnce` guard, so the
					// outer catch's `close()` becomes a no-op for the
					// destructive step and only runs `releaseLock` cleanup
					// — a no-op too when `#crawlUntilPendingClears` already
					// released it itself before throwing.
					try {
						setupProgress?.onPhase?.(RECOVERY_LEAVE_STATE_FOR_RESUME);
						await archive.releaseHandle();
					} catch (persistError) {
						throw new AggregateError(
							[error, persistError],
							'inventory scrape phase failed AND releasing the archive handle also failed. The archive may be in an inconsistent state — check tmpDir.',
						);
					}
					throw error;
				}
				try {
					setupProgress?.onPhase?.(RECOVERY_RESTORE_FROM_BACKUP);
					await copyFileWithProgress(
						backupPath,
						absFilePath,
						setupProgress?.onCopyProgress,
					);
					await ignoreEnoent(unlinkFile(backupPath));
				} catch (restoreError) {
					throw new AggregateError(
						[error, restoreError],
						`inventory failed AND restore from backup failed. Original archive backup is left at: ${backupPath}`,
					);
				}
				throw error;
			}
		} catch (error) {
			await archive.close().catch(() => {});
			throw error;
		}
	}

	/**
	 * Re-fetch pages named by an operator-supplied URL list, importing any
	 * URL the archive does not yet track as a new inventory seed.
	 *
	 * `recrawl` is `retryFailed`'s un-scrape combined with `inventory`'s
	 * novel-URL ingestion, run inside one `.bak`-protected window: URLs in
	 * `recrawlUrls` that already exist as `content_items` rows are reset back
	 * to pending via {@link Archive.resetPagesByUrls} (see that method for the
	 * conservative exclusion rules — redirect sources, intentionally-skipped
	 * pages, and external pages are matched but never reset), while URLs the
	 * archive has never seen are ingested exactly as `inventory` does (see
	 * {@link CrawlerOrchestrator.inventory}'s JSDoc for that half's contract).
	 * Existing *resources* matched by the list are neither resettable nor
	 * novel — `resource_items` is first-write-wins (a known deviation, see
	 * ARCHITECTURE.md), so a resource re-fetch would not update anything; the
	 * function reports how many list entries fell into this bucket via
	 * `setupProgress.onLog` without acting on them.
	 *
	 * Unlike `inventory`, whose sole early-return condition is "no novel
	 * URLs", `recrawl` also has existing pages to act on — the `.bak` is
	 * skipped only when BOTH `existingPageUrls` (reset candidates) AND
	 * `novelUrls` (ingestion candidates) are empty.
	 *
	 * **Strict-pending gap**: `getCrawlingState()`'s pending set only includes
	 * a `scraped = 0` row that is either anchor-referenced or explicitly
	 * labelled (see that function's JSDoc). When `recrawlUrls` contains pages
	 * that link to each other, resetting one page also deletes its outgoing
	 * `anchor_edges` — so a `source = 'crawled'` sibling that was reset in the
	 * same pass can lose its only anchor referrer and fall out of the strict
	 * pending set, silently skipping its re-fetch. `retryFailed` never hits
	 * this because a failed page's referrers are not themselves reset. The
	 * fix: every URL `Archive.resetPagesByUrls` actually reset is merged into
	 * the pending list handed to `Crawler#resume` regardless of what the
	 * strict scan finds, deduplicated by `LinkList.add`'s `protocolAgnosticKey`
	 * check. A Ctrl+C between the reset and the scrape phase loses this
	 * synthetic merge (it lives only in memory) — `crawl --resume` recovers
	 * whatever the strict-pending scan finds on its own, and re-running
	 * `--recrawl` with the same list recovers the rest, matching the
	 * "un-picked seeds" recovery contract `getCrawlingState`'s JSDoc already
	 * documents for `inventory`.
	 *
	 * **Stale analyze findings**: resetting a page deletes its
	 * `analysis_violations` rows (see {@link resetPagesByUrls}'s JSDoc) so a
	 * re-fetched page never shows findings from HTML that no longer exists,
	 * but other `analyze` outputs (e.g. Discrepancies plugin reports) are not
	 * page-scoped and cannot be selectively invalidated. When at least one
	 * page was reset, a `crawlSessionNotice` is emitted after the crawl
	 * completes recommending `analyze` be re-run before the next `report`.
	 * @param archivePath - Absolute or relative path to the existing `.nitpicker`.
	 * @param recrawlUrls - URLs to match against the archive (existing pages
	 *   are reset; unknown URLs are ingested as new inventory seeds).
	 * @param options - Optional config overrides applied on top of the archived config.
	 * @param initializedCallback - Optional callback invoked after initialization but before crawling resumes.
	 * @param source - The CLI's already-read URL list source bytes, archived
	 *   for audit purposes — see {@link InventorySource}. `null` for
	 *   programmatic callers with no source file.
	 * @param setupProgress - Optional progress callbacks for the setup phase
	 *   (untar, `.bak` copy, URL classification, reset, seed ingestion, state
	 *   rebuild) that runs before `initializedCallback` — see
	 *   {@link SetupProgressCallbacks} for why this can't go through the
	 *   orchestrator's event emitter (issue #294).
	 * @returns The orchestrator instance after the recrawl completes.
	 * @throws {Error} When `recrawlUrls` is empty or the archive is in list mode.
	 * @throws {PendingUrlsRemainError} When the crawl session ends with pages still pending after exhausting auto-retry.
	 */
	static async recrawl(
		archivePath: string,
		recrawlUrls: string[],
		options?: Partial<CrawlConfig>,
		initializedCallback?: CrawlInitializedCallback,
		source: InventorySource | null = null,
		setupProgress?: SetupProgressCallbacks,
	) {
		const [
			PHASE_EXTRACTING,
			PHASE_LOADING_CONFIG,
			PHASE_LOADING_CRAWL_STATE_PRE,
			PHASE_CHECKING_KNOWN_URLS,
			PHASE_BACKING_UP,
			PHASE_RESETTING_MATCHED,
			PHASE_RECORDING_NON_HTML,
			PHASE_RECORDING_HTML_SEEDS,
			PHASE_RECORDING_EXCLUDED,
			PHASE_LOADING_CRAWL_STATE_POST,
			PHASE_LOADING_RESOURCES,
			PHASE_LOADING_SCRAPED_COUNT,
			PHASE_RESTORING_CRAWL_STATE,
		] = RECRAWL_SETUP_PHASES;
		if (recrawlUrls.length === 0) {
			throw new Error('recrawl: URL list is empty');
		}
		const cwd = options?.cwd ?? process.cwd();
		const absFilePath = path.isAbsolute(archivePath)
			? archivePath
			: path.resolve(cwd, archivePath);

		// See `ArchiveOpenOptions.openPluginData` for why this must be `true`
		// on every writer path that calls `write()`.
		setupProgress?.onPhase?.(PHASE_EXTRACTING);
		const archive = await Archive.open({
			filePath: absFilePath,
			cwd,
			openPluginData: true,
			onExtractProgress: setupProgress?.onExtractProgress,
			onLog: setupProgress?.onLog,
		});
		try {
			setupProgress?.onPhase?.(PHASE_LOADING_CONFIG);
			const archived = await archive.getConfig();
			if (archived.fromList) {
				throw new Error(
					'Cannot recrawl a list-mode archive: this archive was created with --list/--list-file and contains metadata-only pages. Create a fresh archive instead.',
				);
			}
			// Stamped for `Archive.resume` (issue #350) — same rationale as
			// `inventory`'s identical call.
			await archive.updateConfig(buildCreatedCwdPatch(cwd));

			setupProgress?.onPhase?.(PHASE_LOADING_CRAWL_STATE_PRE);
			const { pending } = await archive.getCrawlingState();
			if (pending.length > 0) {
				// Same rationale as `inventory`'s identical warning — routed
				// through `setupProgress.onLog`, not a bare `console.warn`,
				// since the `'Loading crawl state'` row is active here.
				const message = `recrawl: archive has ${pending.length} pending URLs from a previous crawl. Proceeding — crawled-wins priority keeps their labels stable. Consider \`--resume\` first if you want the prior work finalized.`;
				if (setupProgress?.onLog) {
					setupProgress.onLog(message);
				} else {
					// eslint-disable-next-line no-console -- --silent has no TaskList row to report through
					console.warn(message);
				}
			}

			// Archive the exact source bytes before scope classification —
			// same rationale as `inventory`'s identical call.
			if (source) {
				await archive.saveInventorySourceList(source.sha256, source.bytes);
			}

			setupProgress?.onPhase?.(PHASE_CHECKING_KNOWN_URLS);
			const { outOfScope, existingPageUrls, existingResourceUrls, novelUrls } =
				await CrawlerOrchestrator.#classifyInventoryCandidateUrls(
					recrawlUrls,
					archived,
					archive,
				);
			if (existingResourceUrls.length > 0) {
				const message = `recrawl: ${existingResourceUrls.length} URL(s) matched existing resources — not re-fetched (resource rows are first-write-wins; re-fetching would not update them).`;
				if (setupProgress?.onLog) {
					setupProgress.onLog(message);
				} else {
					// eslint-disable-next-line no-console -- --silent has no TaskList row to report through
					console.warn(message);
				}
			}

			const effectiveConfig = { ...archived, ...cleanObject(options) };
			const { excludedNovelUrls, importableNovelUrls } =
				CrawlerOrchestrator.#classifyExcludedNovelUrls(novelUrls, effectiveConfig);

			if (existingPageUrls.length === 0 && novelUrls.length === 0) {
				// Nothing to do — release the archive cleanly without taking a
				// backup, mirroring `inventory`'s zero-novel early return.
				const orchestrator = new CrawlerOrchestrator(archive, effectiveConfig);
				if (initializedCallback) {
					await initializedCallback(orchestrator, effectiveConfig);
				}
				return orchestrator;
			}

			const backupPath = absFilePath + '.bak';
			setupProgress?.onPhase?.(PHASE_BACKING_UP);
			await copyFileWithProgress(absFilePath, backupPath, setupProgress?.onCopyProgress);

			let ingestionComplete = false;
			try {
				setupProgress?.onPhase?.(PHASE_RESETTING_MATCHED);
				const resetResult = await archive.resetPagesByUrls(
					existingPageUrls,
					setupProgress?.onChunkProgress,
				);
				const excludedTotal =
					resetResult.excludedRedirects.length +
					resetResult.excludedSkipped.length +
					resetResult.excludedExternal.length;
				// `existingPageUrls` (from `getExistingPageUrls`) matches by URL
				// alone, regardless of `scraped` — it can include rows still
				// pending from an interrupted previous session. Those rows are
				// absent from every `resetPagesByUrls` array (see that
				// function's JSDoc: "already pending, nothing to reset"), so
				// the three counts below alone would not sum back to
				// `existingPageUrls.length` and the message would look like
				// pages vanished unexplained. Naming this remainder keeps the
				// arithmetic honest for an operator auditing the summary.
				const alreadyPendingCount =
					existingPageUrls.length - resetResult.resetUrls.length - excludedTotal;
				const summaryMessage = `recrawl: matched ${existingPageUrls.length} existing page(s) — reset ${resetResult.resetUrls.length}, excluded ${excludedTotal} (${resetResult.excludedRedirects.length} redirect source(s), ${resetResult.excludedSkipped.length} intentionally-skipped, ${resetResult.excludedExternal.length} external), already pending ${alreadyPendingCount}.`;
				if (setupProgress?.onLog) {
					setupProgress.onLog(summaryMessage);
				} else {
					// eslint-disable-next-line no-console -- --silent has no TaskList row to report through
					console.warn(summaryMessage);
				}

				const { htmlSeeds, nonHtmlSeeds } = await CrawlerOrchestrator.#ingestNovelSeeds({
					archive,
					importableNovelUrls,
					excludedNovelUrls,
					setupProgress,
					phaseRecordingNonHtml: PHASE_RECORDING_NON_HTML,
					phaseRecordingHtmlSeeds: PHASE_RECORDING_HTML_SEEDS,
					phaseRecordingExcluded: PHASE_RECORDING_EXCLUDED,
				});
				// Audit row is written *inside* the `.bak` window — same
				// all-or-nothing rationale as `inventory`'s identical write.
				await CrawlerOrchestrator.#writeListReconcileRunRow(archive, {
					inventoryUrlsCount: recrawlUrls.length,
					htmlSeedsCount: htmlSeeds.length,
					nonHtmlCount: nonHtmlSeeds.length,
					outOfScope,
					excludeSkipped: excludedNovelUrls.length,
					sourceFileSha256: source?.sha256 ?? null,
					invalidSkipped: source?.invalidLineCount ?? null,
					listLabelPrefix: 'recrawl',
					notes: `Reset ${resetResult.resetUrls.length} existing page(s) for re-fetch`,
				});
				ingestionComplete = true;
				await ignoreEnoent(unlinkFile(backupPath));

				const baseConfig: Config = {
					...effectiveConfig,
					recursive: true,
					fromList: false,
				};
				const seedSet = new Set(htmlSeeds.map((u) => u.withoutHashAndAuth));
				const orchestratorOptions: Partial<CrawlConfig> = {
					...baseConfig,
					inventoryMode: { seedUrls: seedSet },
				};

				if (resetResult.resetUrls.length > 0 || htmlSeeds.length > 0) {
					orchestratorOptions.preloadedStickyShapeKeys =
						await archive.listDedupeCapShapeKeys();
					const orchestrator = new CrawlerOrchestrator(archive, orchestratorOptions);
					setupProgress?.onPhase?.(PHASE_LOADING_CRAWL_STATE_POST);
					const { scraped: scrapedAfter, pending: pendingAfter } =
						await archive.getCrawlingState();
					// Merge the reset URLs into the pending set explicitly —
					// see this method's "Strict-pending gap" JSDoc section.
					// Deduped by `LinkList.add`'s own key check, so a URL the
					// strict scan already found is harmless to repeat here.
					const pendingWithReset = [
						...new Set([...pendingAfter, ...resetResult.resetUrls]),
					];
					setupProgress?.onPhase?.(PHASE_LOADING_RESOURCES);
					const resources = await archive.getResourceUrlList(
						setupProgress?.onChunkProgress,
					);
					setupProgress?.onPhase?.(PHASE_LOADING_SCRAPED_COUNT);
					const pagesScrapedOffset = await archive.getScrapedHtmlPageCount();
					setupProgress?.onPhase?.(PHASE_RESTORING_CRAWL_STATE);
					orchestrator.#crawler.resume(
						pendingWithReset,
						scrapedAfter,
						resources,
						pagesScrapedOffset,
					);
					if (initializedCallback) {
						await initializedCallback(orchestrator, baseConfig);
					}
					log('Start recrawl');
					log('Archive %s', absFilePath);
					log(
						'Reset %d page(s), %d new HTML seed(s)',
						resetResult.resetUrls.length,
						htmlSeeds.length,
					);
					await CrawlerOrchestrator.#preloadDnsBurnedHostCache(archive);
					await orchestrator.#crawlUntilPendingClears([], { recursive: true });
					CrawlerOrchestrator.#finalizeCrawlSession(orchestrator);
					if (resetResult.resetUrls.length > 0) {
						void orchestrator.emit('crawlSessionNotice', {
							message: `[recrawl] Reset ${resetResult.resetUrls.length} page(s) — run \`analyze\` before \`report\` to refresh their findings.`,
						});
					}
					await orchestrator.#setUrlOrder();
					return orchestrator;
				}

				// Only non-HTML URLs were imported and nothing was reset —
				// nothing left to render, but still update sort order.
				const orchestrator = new CrawlerOrchestrator(archive, orchestratorOptions);
				if (initializedCallback) {
					await initializedCallback(orchestrator, baseConfig);
				}
				await orchestrator.#setUrlOrder();
				return orchestrator;
			} catch (error) {
				if (ingestionComplete) {
					// Same rationale as `inventory`'s identical catch — see
					// that method's comment. Scrape failure here can equally
					// be the auto-retry loop (issue #350) giving up.
					try {
						setupProgress?.onPhase?.(RECOVERY_LEAVE_STATE_FOR_RESUME);
						await archive.releaseHandle();
					} catch (persistError) {
						throw new AggregateError(
							[error, persistError],
							'recrawl scrape phase failed AND releasing the archive handle also failed. The archive may be in an inconsistent state — check tmpDir.',
						);
					}
					throw error;
				}
				try {
					setupProgress?.onPhase?.(RECOVERY_RESTORE_FROM_BACKUP);
					await copyFileWithProgress(
						backupPath,
						absFilePath,
						setupProgress?.onCopyProgress,
					);
					await ignoreEnoent(unlinkFile(backupPath));
				} catch (restoreError) {
					throw new AggregateError(
						[error, restoreError],
						`recrawl failed AND restore from backup failed. Original archive backup is left at: ${backupPath}`,
					);
				}
				throw error;
			}
		} catch (error) {
			await archive.close().catch(() => {});
			throw error;
		}
	}

	/**
	 * Shared first-stage classification for `inventory` and `recrawl`: parse
	 * the candidate URLs, split them by the archived scope map into
	 * in-scope/out-of-scope, then split the in-scope set into URLs already
	 * represented in the archive (as a page or a resource) vs. novel URLs the
	 * archive has never seen. Comparison key is `withoutHashAndAuth` to
	 * mirror what `resolveContentItemId` / `insertResource` actually store.
	 *
	 * The two existing-URL reads run concurrently via `Promise.all` — halves
	 * the wait on large archives where each `WHERE url IN (?)` chunk costs
	 * real I/O.
	 * @param rawUrls - The operator-supplied URL list, unparsed.
	 * @param archived - The archive's persisted config (`roots` defines scope).
	 * @param archive - The opened archive to query for existing URLs.
	 * @returns `outOfScope` (count dropped by the scope filter),
	 *   `existingPageUrls` / `existingResourceUrls` (URLs already known, by
	 *   kind), and `novelUrls` (parsed, in-scope URLs matching neither).
	 */
	static async #classifyInventoryCandidateUrls(
		rawUrls: string[],
		archived: Config,
		archive: Archive,
	): Promise<{
		outOfScope: number;
		existingPageUrls: string[];
		existingResourceUrls: string[];
		novelUrls: ExURL[];
	}> {
		const parsedAll = sortUrl(rawUrls, archived);
		const scopeMap = new Map<string, ExURL[]>();
		for (const raw of archived.roots) {
			const parsed = parseUrl(raw, archived);
			if (!parsed) continue;
			const existing = scopeMap.get(parsed.hostname) ?? [];
			scopeMap.set(parsed.hostname, [...existing, parsed]);
		}
		const inScope: ExURL[] = [];
		let outOfScope = 0;
		for (const url of parsedAll) {
			if (findScopeEntry(url, scopeMap, archived) === null) {
				outOfScope++;
			} else {
				inScope.push(url);
			}
		}
		if (outOfScope > 0) {
			log(
				'[ingest] %d URL(s) skipped (outside archived scope: %O)',
				outOfScope,
				archived.roots,
			);
		}

		const candidateUrls = inScope.map((u) => u.withoutHashAndAuth);
		const [existingPageUrls, existingResourceUrls] = await Promise.all([
			archive.getExistingPageUrls(candidateUrls),
			archive.getExistingResourceUrls(candidateUrls),
		]);
		const existingPageUrlSet = new Set(existingPageUrls);
		const existingResourceUrlSet = new Set(existingResourceUrls);
		const novelUrls = inScope.filter((u) => {
			const key = u.withoutHashAndAuth;
			return !existingPageUrlSet.has(key) && !existingResourceUrlSet.has(key);
		});
		log(
			'[ingest] %d in-scope, %d already in archive, %d new',
			inScope.length,
			existingPageUrlSet.size + existingResourceUrlSet.size,
			novelUrls.length,
		);

		return { outOfScope, existingPageUrls, existingResourceUrls, novelUrls };
	}

	/**
	 * Shared second-stage classification for `inventory` and `recrawl`:
	 * splits novel URLs on the exclusion config BEFORE the HTML/non-HTML
	 * classification, so an exclude-matched URL is recorded as a terminal
	 * skipped page instead of being imported (issue #260).
	 *
	 * The inputs mirror the scrape phase's fetch-time gate (`shouldSkipUrl`
	 * in `crawler.ts` fed by the constructor's merge): archived config
	 * overlaid with this run's overrides, and `DEFAULT_EXCLUDED_EXTERNAL_URLS`
	 * merged ahead of the user's prefixes — classification and gate must
	 * never disagree about the same URL. Running this AFTER the known-URL
	 * filter (`#classifyInventoryCandidateUrls`) is deliberate: a previously
	 * crawled row that newly matches the exclusion config stays untouched
	 * (crawled-wins), matching how `getExistingPageUrls` shields known rows
	 * from re-labelling. `excludeKeywords` is deliberately absent: it matches
	 * rendered page content, which a URL list does not have — HTML seeds
	 * still get it at render time via the browser verdict.
	 * @param novelUrls - URLs not yet represented in the archive, from
	 *   `#classifyInventoryCandidateUrls`.
	 * @param effectiveConfig - The archived config overlaid with this run's
	 *   overrides (the same merge the caller uses to build its own config).
	 * @returns `excludedNovelUrls` (matched `excludes`/`excludeUrls`, to be
	 *   recorded as terminal skipped pages) and `importableNovelUrls` (the rest).
	 */
	static #classifyExcludedNovelUrls(
		novelUrls: ExURL[],
		effectiveConfig: Config,
	): { excludedNovelUrls: ExURL[]; importableNovelUrls: ExURL[] } {
		const excludes = normalizeToArray(effectiveConfig.excludes);
		const excludeUrls = [
			...DEFAULT_EXCLUDED_EXTERNAL_URLS,
			...normalizeToArray(effectiveConfig.excludeUrls),
		];
		const excludedNovelUrls: ExURL[] = [];
		const importableNovelUrls: ExURL[] = [];
		for (const url of novelUrls) {
			if (shouldSkipUrl({ url, excludes, excludeUrls, options: effectiveConfig })) {
				excludedNovelUrls.push(url);
			} else {
				importableNovelUrls.push(url);
			}
		}
		if (excludedNovelUrls.length > 0) {
			log(
				'[ingest] %d URL(s) recorded as skipped (matched excludes / excludeUrls)',
				excludedNovelUrls.length,
			);
		}
		return { excludedNovelUrls, importableNovelUrls };
	}

	/**
	 * Shared third-stage ingestion for `inventory` and `recrawl`: classifies
	 * importable novel URLs by URL-extension heuristic (no I/O), dedups HTML
	 * seeds, and bulk-records both kinds into the archive.
	 *
	 * Source file lists come from `ls` on the doc-root, so the extension
	 * reflects the real file type — a HEAD pre-flight here would be pure
	 * wasted I/O. Edge cases:
	 *
	 * - `.html` returning 404 / 200: the normal crawler HEAD/GET path absorbs
	 *   this because every HTML-classified URL is fed through the dealer and
	 *   gets its real HEAD/GET there.
	 * - Extensionless API endpoints (e.g. `/api/foo`) that the server returns
	 *   as `text/html`: `isLikelyHtmlUrl` accepts them as HTML so the
	 *   dealer's render path runs — the real content-type wins downstream.
	 * - `.aspx` / `.do` / `.jsp` / other server-handler extensions the
	 *   heuristic does NOT recognise as HTML: classified as non-HTML,
	 *   recorded as `resources` rows with all-null metadata, never get a
	 *   HEAD/GET probe. Sites that mix server-handlers into the list need a
	 *   follow-up `--retry-failed` pass (or a re-run with the corrected list)
	 *   to populate metadata.
	 *
	 * HTML seeds are deduped by `protocolAgnosticKey` so a list mixing
	 * `http://` and `https://` for the same origin does not produce two rows
	 * that the dealer later collapses to one — the loser would otherwise stay
	 * `scraped=0, source='inventory-seed'` forever and look like a real
	 * recovery candidate on `--resume`. `getExistingPageUrls` keys on the
	 * full URL (with protocol), so it cannot catch the cross-scheme
	 * duplicate; this is the dedup boundary.
	 *
	 * Non-HTML URLs are bulk-recorded via `insertInventoryResources` — a
	 * per-URL loop would spend minutes inside the `.bak`-protected window on
	 * a large list; the chunked bulk path collapses N round-trips to N/500.
	 * HTML seeds are pre-inserted as `scraped = 0`, `source =
	 * 'inventory-seed'` placeholders *before* the scrape phase, so a Ctrl+C
	 * between here and `setPage` cannot lose the URL — the strict-pending set
	 * picks these rows up on the next `--resume` via the `OR p.source !=
	 * 'crawled'` clause. Exclude-matched novel URLs are recorded as terminal
	 * skipped pages (`is_skipped=1`, `skip_reason='excluded'`,
	 * `source='inventory-seed'`) — the same end state the normal crawl's
	 * fetch-time gate produces for link-discovered excluded URLs.
	 * @param options - Named parameters (4+ values).
	 * @param options.archive - The opened archive to write into.
	 * @param options.importableNovelUrls - Novel URLs not matched by excludes.
	 * @param options.excludedNovelUrls - Novel URLs matched by excludes, from `#classifyExcludedNovelUrls`.
	 * @param options.setupProgress - Optional setup progress callbacks.
	 * @param options.phaseRecordingNonHtml - The `onPhase` label to announce before recording non-HTML resources.
	 * @param options.phaseRecordingHtmlSeeds - The `onPhase` label to announce before recording HTML seed pages.
	 * @param options.phaseRecordingExcluded - The `onPhase` label to announce before recording excluded pages.
	 * @returns `htmlSeeds` and `nonHtmlSeeds` — the deduped, classified novel URLs actually recorded.
	 */
	static async #ingestNovelSeeds(options: {
		archive: Archive;
		importableNovelUrls: ExURL[];
		excludedNovelUrls: ExURL[];
		setupProgress?: SetupProgressCallbacks;
		phaseRecordingNonHtml: SetupPhaseLabel;
		phaseRecordingHtmlSeeds: SetupPhaseLabel;
		phaseRecordingExcluded: SetupPhaseLabel;
	}): Promise<{ htmlSeeds: ExURL[]; nonHtmlSeeds: ExURL[] }> {
		const {
			archive,
			importableNovelUrls,
			excludedNovelUrls,
			setupProgress,
			phaseRecordingNonHtml,
			phaseRecordingHtmlSeeds,
			phaseRecordingExcluded,
		} = options;
		const rawHtmlSeeds: ExURL[] = [];
		const nonHtmlSeeds: ExURL[] = [];
		for (const url of importableNovelUrls) {
			if (isLikelyHtmlUrl(url)) {
				rawHtmlSeeds.push(url);
			} else {
				nonHtmlSeeds.push(url);
			}
		}
		const seenKeys = new Set<string>();
		const htmlSeeds: ExURL[] = [];
		for (const url of rawHtmlSeeds) {
			const key = protocolAgnosticKey(url.withoutHashAndAuth);
			if (seenKeys.has(key)) {
				continue;
			}
			seenKeys.add(key);
			htmlSeeds.push(url);
		}
		setupProgress?.onPhase?.(phaseRecordingNonHtml);
		await archive.insertInventoryResources(nonHtmlSeeds);
		setupProgress?.onPhase?.(phaseRecordingHtmlSeeds);
		await archive.insertInventorySeeds(htmlSeeds);
		setupProgress?.onPhase?.(phaseRecordingExcluded);
		await archive.insertInventorySkippedPages(excludedNovelUrls);
		log(
			'[ingest] %d HTML seed(s), %d non-HTML resource(s), %d skipped page(s) recorded',
			htmlSeeds.length,
			nonHtmlSeeds.length,
			excludedNovelUrls.length,
		);
		return { htmlSeeds, nonHtmlSeeds };
	}

	/**
	 * Re-fetch previously-failed pages in an existing `.nitpicker` archive.
	 *
	 * Opens the archive, resets every page whose previous attempt ended in a
	 * recoverable failure (missing status / content type, or a 5xx status — see
	 * {@link Archive.resetFailedPages}) back to pending, and resumes crawling.
	 * The archived crawl configuration is reused — scopes, excludes, keywords,
	 * user agent, etc. — so the retry honours the original crawl boundaries
	 * unless a field is explicitly overridden via `options`. The exception is
	 * `recursive`: it is taken from `options` (the CLI flag defaults it to
	 * `true`) rather than inherited from the archive, so a retry decides afresh
	 * whether to follow newly-discovered URLs regardless of how the original
	 * crawl was run.
	 *
	 * When `recursive` is enabled (the default), newly-discovered URLs from the
	 * re-fetched pages are followed and crawled from scratch; when disabled, only
	 * the failed pages themselves are re-fetched. The archived roots seed the
	 * crawl scope while the reset pages are picked up through the resumed pending
	 * set, so failed external pages stay external (metadata-only) instead of being
	 * promoted into scope, and a failed root is re-fetched in place.
	 *
	 * A `<archive>.bak` is created before any DB mutation and removed on success;
	 * if the crawl throws, the backup is restored to keep the original archive
	 * intact — except when the crawl ends with {@link PendingUrlsRemainError}
	 * (issue #350), where the un-packaged stub itself is the recovery path and
	 * the backup is instead left untouched (deleted, not restored — see
	 * {@link CrawlerOrchestrator.#abandonBackupOnPendingRemains}).
	 *
	 * List-mode archives (`info.fromList === true`) are rejected for the same
	 * reason as {@link CrawlerOrchestrator.append}: their pages are metadata-only.
	 * @param archivePath - Absolute or relative path to the existing `.nitpicker`.
	 * @param options - Optional config overrides applied on top of the archived config.
	 * @param initializedCallback - Optional callback invoked after initialization but before crawling resumes.
	 * @param setupProgress - Optional progress callbacks for the setup phase
	 *   (untar, `.bak` copy, reset, state rebuild) that runs before
	 *   `initializedCallback` — see {@link SetupProgressCallbacks} for why
	 *   this can't go through the orchestrator's event emitter (issue #294).
	 * @returns The orchestrator instance after the retry crawl completes.
	 * @throws {Error} When the archive is in list mode or has no parseable roots.
	 * @throws {PendingUrlsRemainError} When the crawl session ends with pages still pending after exhausting auto-retry.
	 */
	static async retryFailed(
		archivePath: string,
		options?: Partial<CrawlConfig>,
		initializedCallback?: CrawlInitializedCallback,
		setupProgress?: SetupProgressCallbacks,
	) {
		const [
			PHASE_EXTRACTING,
			PHASE_LOADING_CONFIG,
			PHASE_BACKING_UP,
			PHASE_RESETTING_FAILED,
			PHASE_LOADING_DEDUPE_KEYS,
			PHASE_LOADING_CRAWL_STATE,
			PHASE_LOADING_RESOURCES,
			PHASE_LOADING_SCRAPED_COUNT,
			PHASE_RESTORING_CRAWL_STATE,
		] = RETRY_FAILED_SETUP_PHASES;
		const cwd = options?.cwd ?? process.cwd();
		const absFilePath = path.isAbsolute(archivePath)
			? archivePath
			: path.resolve(cwd, archivePath);

		// See `ArchiveOpenOptions.openPluginData` for why this must be `true`
		// on every writer path that calls `write()`.
		setupProgress?.onPhase?.(PHASE_EXTRACTING);
		const archive = await Archive.open({
			filePath: absFilePath,
			cwd,
			openPluginData: true,
			onExtractProgress: setupProgress?.onExtractProgress,
			onLog: setupProgress?.onLog,
		});
		// Any throw between here and the successful return must release the
		// archive lock and clean up tmpDir; the caller's `close()` only runs on
		// the happy path.
		try {
			setupProgress?.onPhase?.(PHASE_LOADING_CONFIG);
			const archived = await archive.getConfig();
			if (archived.fromList) {
				throw new Error(
					'Cannot retry a list-mode archive: this archive was created with --list/--list-file and contains metadata-only pages. Create a fresh archive instead.',
				);
			}
			// Stamped for `Archive.resume` (issue #350) — same rationale as
			// `inventory`'s identical call.
			await archive.updateConfig(buildCreatedCwdPatch(cwd));

			const rootsParsed = sortUrl(archived.roots, archived);
			if (rootsParsed.length === 0) {
				throw new Error('retry: archive has no parseable root URLs');
			}

			const config: Config = {
				...archived,
				...cleanObject(options),
				roots: archived.roots,
				fromList: false,
				baseUrl: archived.baseUrl,
			};

			const backupPath = absFilePath + '.bak';
			setupProgress?.onPhase?.(PHASE_BACKING_UP);
			await copyFileWithProgress(absFilePath, backupPath, setupProgress?.onCopyProgress);

			try {
				setupProgress?.onPhase?.(PHASE_RESETTING_FAILED);
				const resetUrls = await archive.resetFailedPages(setupProgress?.onChunkProgress);
				log('Start retrying failed pages');
				log('Archive %s', absFilePath);
				log('Reset %d failed page(s)', resetUrls.length);

				// Seed the sticky set from prior sessions' confirmed traps so
				// `--retry-failed` does not pay the cost of re-discovering
				// them (see `DedupeCapTracker`'s constructor JSDoc).
				setupProgress?.onPhase?.(PHASE_LOADING_DEDUPE_KEYS);
				const preloadedStickyShapeKeys = await archive.listDedupeCapShapeKeys();
				const orchestrator = new CrawlerOrchestrator(archive, {
					...config,
					preloadedStickyShapeKeys,
				});
				setupProgress?.onPhase?.(PHASE_LOADING_CRAWL_STATE);
				const { scraped, pending } = await archive.getCrawlingState();
				setupProgress?.onPhase?.(PHASE_LOADING_RESOURCES);
				const resources = await archive.getResourceUrlList(
					setupProgress?.onChunkProgress,
				);
				setupProgress?.onPhase?.(PHASE_LOADING_SCRAPED_COUNT);
				const pagesScrapedOffset = await archive.getScrapedHtmlPageCount();
				setupProgress?.onPhase?.(PHASE_RESTORING_CRAWL_STATE);
				orchestrator.#crawler.resume(pending, scraped, resources, pagesScrapedOffset);
				if (initializedCallback) {
					await initializedCallback(orchestrator, config);
				}
				await CrawlerOrchestrator.#preloadDnsBurnedHostCache(archive);
				await orchestrator.#crawlUntilPendingClears([], { recursive: config.recursive });
				CrawlerOrchestrator.#finalizeCrawlSession(orchestrator);
				await orchestrator.#setUrlOrder();
				await ignoreEnoent(unlinkFile(backupPath));
				return orchestrator;
			} catch (error) {
				if (error instanceof PendingUrlsRemainError) {
					await CrawlerOrchestrator.#abandonBackupOnPendingRemains(
						setupProgress,
						backupPath,
					);
					throw error;
				}
				try {
					setupProgress?.onPhase?.(RECOVERY_RESTORE_FROM_BACKUP);
					await copyFileWithProgress(
						backupPath,
						absFilePath,
						setupProgress?.onCopyProgress,
					);
					await ignoreEnoent(unlinkFile(backupPath));
				} catch (restoreError) {
					// Restore itself failed — surface both so the operator knows
					// the .bak still exists and the original archive may be
					// corrupt. The outer `catch` still releases the lock.
					throw new AggregateError(
						[error, restoreError],
						`retry failed AND restore from backup failed. Original archive backup is left at: ${backupPath}`,
					);
				}
				throw error;
			}
		} catch (error) {
			await archive.close().catch(() => {});
			throw error;
		}
	}

	/**
	 * Resume a previously interrupted crawl from an existing archive file.
	 *
	 * Restores the crawl state (pending URLs, scraped URLs, and resources)
	 * from the archive, merges any option overrides, and continues crawling
	 * from where it left off.
	 * @param stubPath - Path to the existing archive file to resume from.
	 * @param options - Optional configuration overrides to apply on top of the archived config.
	 * @param initializedCallback - Optional callback invoked after initialization but before crawling resumes.
	 * @param setupProgress - Optional progress callbacks for the setup phase
	 *   (self-healing migrations, state rebuild) that runs before
	 *   `initializedCallback` — see {@link SetupProgressCallbacks} for why
	 *   this can't go through the orchestrator's event emitter (issue #294).
	 *   No `onExtractProgress`/`onCopyProgress`: unlike `append`/`inventory`/
	 *   `retryFailed`, `resume` reconnects to an existing tmpDir (no untar)
	 *   and takes no `.bak` (nothing to restore — the interrupted crawl's
	 *   tmpDir IS the source of truth).
	 * @returns A promise that resolves to the CrawlerOrchestrator instance after crawling completes.
	 * @throws {Error} If the archived URL is invalid.
	 * @throws {PendingUrlsRemainError} When the crawl session ends with pages still pending after exhausting auto-retry.
	 */
	static async resume(
		stubPath: string,
		options?: Partial<CrawlConfig>,
		initializedCallback?: CrawlInitializedCallback,
		setupProgress?: SetupProgressCallbacks,
	) {
		const [
			PHASE_RECONNECTING,
			PHASE_LOADING_CONFIG,
			PHASE_LOADING_DEDUPE_KEYS,
			PHASE_LOADING_CRAWL_STATE,
			PHASE_LOADING_RESOURCES,
			PHASE_LOADING_SCRAPED_COUNT,
			PHASE_RESTORING_CRAWL_STATE,
		] = RESUME_SETUP_PHASES;
		setupProgress?.onPhase?.(PHASE_RECONNECTING);
		const archive = await Archive.resume(stubPath, setupProgress?.onLog);
		setupProgress?.onPhase?.(PHASE_LOADING_CONFIG);
		const archivedConfig = await archive.getConfig();
		// Seed the sticky set from prior sessions' confirmed traps so
		// `--resume` does not pay the cost of re-discovering them (see
		// `DedupeCapTracker`'s constructor JSDoc).
		setupProgress?.onPhase?.(PHASE_LOADING_DEDUPE_KEYS);
		const preloadedStickyShapeKeys = await archive.listDedupeCapShapeKeys();
		const config = {
			...archivedConfig,
			...cleanObject(options),
			preloadedStickyShapeKeys,
		};
		const orchestrator = new CrawlerOrchestrator(archive, config);
		const _url = await archive.getUrl();
		const url = parseUrl(_url, config);
		if (!url) {
			throw new Error(`URL (${_url}) is invalid`);
		}
		setupProgress?.onPhase?.(PHASE_LOADING_CRAWL_STATE);
		const { scraped, pending } = await archive.getCrawlingState();
		setupProgress?.onPhase?.(PHASE_LOADING_RESOURCES);
		const resources = await archive.getResourceUrlList(setupProgress?.onChunkProgress);
		setupProgress?.onPhase?.(PHASE_LOADING_SCRAPED_COUNT);
		const pagesScrapedOffset = await archive.getScrapedHtmlPageCount();
		setupProgress?.onPhase?.(PHASE_RESTORING_CRAWL_STATE);
		orchestrator.#crawler.resume(pending, scraped, resources, pagesScrapedOffset);
		if (initializedCallback) {
			await initializedCallback(orchestrator, config);
		}
		log('Start resuming');
		log('Data %s', stubPath);
		log('URL %s', url.href);
		log('Config %O', config);
		await CrawlerOrchestrator.#preloadDnsBurnedHostCache(archive);
		await orchestrator.#crawlUntilPendingClears([url]);
		CrawlerOrchestrator.#finalizeCrawlSession(orchestrator);
		return orchestrator;
	}

	/**
	 * Shared `PendingUrlsRemainError` recovery step for `append` and
	 * `retryFailed`'s catch blocks (issue #350 code review — `inventory` /
	 * `recrawl` reach the same outcome through their own `ingestionComplete`
	 * branch instead, which has no `.bak` left to clean up by the time it
	 * runs, so this helper is specific to the two `.bak`-restore-by-default
	 * catch shapes).
	 *
	 * `#crawlUntilPendingClears` has already released the archive handle
	 * and left the stub intact for `--resume`/`--retry-failed` by the time
	 * this runs; `write()` never ran, so the original archive file was
	 * never touched. Restoring `.bak` over it would be a wasted
	 * full-archive copy (and show a misleading "Restoring from backup"
	 * phase label) — only the now-unnecessary `.bak` needs cleaning up.
	 * @param setupProgress - Forwarded so the recovery phase label still
	 *   reaches the caller's setup `TaskList`.
	 * @param backupPath - The `.bak` path to delete (`unlinkFile`, ENOENT
	 *   ignored).
	 */
	static async #abandonBackupOnPendingRemains(
		setupProgress: SetupProgressCallbacks | undefined,
		backupPath: string,
	): Promise<void> {
		setupProgress?.onPhase?.(RECOVERY_LEAVE_STATE_FOR_RESUME);
		await ignoreEnoent(unlinkFile(backupPath));
	}

	/**
	 * Seeds {@link dnsBurnedHostCache} from `crawl_errors` history at re-open
	 * (append / inventory / retryFailed / resume). Called after Archive.open
	 * succeeds and before crawling starts, so the first URL on a burned host
	 * already short-circuits — no retry budget is spent on a dead host that
	 * the previous crawl already proved was dead.
	 *
	 * Fresh `crawling()` skips this — there is no archive history to seed
	 * from. Within-session learning still kicks in via the `onGiveUp` mark.
	 * @param archive - The opened archive whose `crawl_errors` is read.
	 */
	static async #preloadDnsBurnedHostCache(archive: Archive): Promise<void> {
		const hosts = await archive.listDnsBurnedHostCandidates();
		for (const host of hosts) {
			dnsBurnedHostCache.set(host, 'dns');
		}
		if (hosts.length > 0) {
			// eslint-disable-next-line no-console
			console.error(
				`[preload] DNS-burned hosts: ${hosts.length} (will short-circuit subsequent URLs)`,
			);
		}
	}

	/**
	 * Persist one `list_reconcile_runs` audit row inside the ingestion phase
	 * of a `--inventory` invocation, before the `.bak` is released. Lives as a
	 * static helper because the audit-row shape (timestamp stamping + label
	 * auto-gen + the privacy-driven path elision documented below) is a
	 * cohesive concern that benefits from staying outside the long
	 * `inventory()` body even though it has a single caller.
	 *
	 * `ran_at` is stamped now (ingestion-completion timestamp; the scrape
	 * phase that may follow is treated as separate). `list_label` is
	 * auto-generated from `ran_at` when the CLI did not pass one — there is
	 * no `--label` flag, so this is always the auto form.
	 * `source_file_sha256` arrives pre-computed via
	 * `aggregates.sourceFileSha256` (the CLI's `inventoryCrawl` ran
	 * `computeFileSha256` against the bytes it read from the input txt,
	 * before the orchestrator was even invoked). The orchestrator boundary
	 * deliberately never sees the absolute path — see
	 * {@link ListReconcileRunAggregates} for the privacy rationale.
	 *
	 * **Audit-write failures abort the ingestion phase.** Swallowing them
	 * would only be justified if the audit were the last write after the
	 * scrape (re-throwing there would wipe a completed crawl); inside the
	 * `.bak`-protected ingestion phase the
	 * trade-off flips. A failed audit row is restorable: the outer catch
	 * copies `.bak` back over the archive and the operator reruns the
	 * (short) ingestion from scratch. That keeps `list_reconcile_runs`
	 * honest (no "ran but unrecorded" rows) at the cost of one rerun.
	 *
	 * Forward-compat: if an explicit `--label` flag is ever added, thread
	 * `labelOverride` through {@link inventory} into the `aggregates`
	 * shape so the auto-name can be overridden.
	 * @param archive - The opened archive to write the audit row into.
	 * @param aggregates - The counts captured during the inventory pass; see {@link ListReconcileRunAggregates}.
	 */
	static async #writeListReconcileRunRow(
		archive: Archive,
		aggregates: ListReconcileRunAggregates,
	): Promise<void> {
		const ranAt = new Date().toISOString();
		await archive.recordListReconcileRun({
			ran_at: ranAt,
			list_label: `${aggregates.listLabelPrefix ?? 'inventory'}-${ranAt}`,
			source_file_sha256: aggregates.sourceFileSha256,
			total_lines: aggregates.inventoryUrlsCount,
			new_pages: aggregates.htmlSeedsCount,
			new_resources: aggregates.nonHtmlCount,
			scope_skipped: aggregates.outOfScope,
			exclude_skipped: aggregates.excludeSkipped,
			invalid_skipped: aggregates.invalidSkipped,
			notes: aggregates.notes ?? null,
		});
	}

	/**
	 * Tears down session-scoped crawler caches and reports a short-circuit
	 * summary if any URL fetches were skipped. Invoked at every
	 * crawl-session boundary (`crawling` / `append` / `inventory` /
	 * `retryFailed` / `resume`), in the same crawl-tail window as
	 * `flushingPendingWrites`/`sortingUrls` — reports through the
	 * `crawlSessionNotice` event rather than a bare `console.error` (issue
	 * #294 code review) for the same reason those two do: this runs while a
	 * caller's `Lanes`/`TaskList` display can already be active, and a
	 * direct stream write there corrupts its cursor tracking.
	 * @param orchestrator - The session's orchestrator instance, to emit
	 *   `crawlSessionNotice` from.
	 */
	static #finalizeCrawlSession(orchestrator: CrawlerOrchestrator): void {
		const skipped = dnsBurnedHostShortCircuitCounter.count;
		if (skipped > 0) {
			void orchestrator.emit('crawlSessionNotice', {
				message: `[preload] Short-circuited ${skipped} URL(s) on DNS-burned hosts`,
			});
		}
		const { confirmedCount, totalDurationMs } = networkOutageSummaryCounter;
		if (confirmedCount > 0) {
			void orchestrator.emit('crawlSessionNotice', {
				message: `[network] ${confirmedCount} outage(s), ${Math.round(totalDurationMs / 1000)}s total`,
			});
		}
		networkOutageSummaryCounter.confirmedCount = 0;
		networkOutageSummaryCounter.totalDurationMs = 0;
		clearDestinationCache();
		clearDnsBurnedHostCache();
	}
}

/**
 * Resolves a `CrawlConfig.cwd` value to an absolute path before it is
 * stamped as `Config.createdCwd` (issue #350). `cwd` is trusted as an
 * absolute base everywhere else in this file (`path.resolve(cwd, ...)` for
 * `absFilePath`/tmpDir), so a caller-supplied relative `cwd` already
 * resolves against `process.cwd()` implicitly for archive placement — this
 * makes that same resolution explicit for the value `Archive.resume` will
 * later read back, so a relative `createdCwd` can never silently
 * reintroduce the cwd-dependent resume path this column exists to fix.
 * `path.resolve` is a no-op when `cwd` is already absolute.
 * @param cwd - The `CrawlConfig.cwd` value (defaults to `process.cwd()` at each call site).
 * @returns An absolute path.
 */
function resolveAbsoluteCwd(cwd: string): string {
	return path.resolve(process.cwd(), cwd);
}

/**
 * Builds the `Config` patch that stamps `createdCwd` (issue #350) — the one
 * field every stub-creating static factory (`crawling`/`append`/`inventory`/
 * `recrawl`/`retryFailed`; `resume` deliberately excluded, it only reads
 * this value) must set. Centralised so a future stub-creating mode spreads
 * this into its `setConfig`/`updateConfig` call instead of hand-rolling
 * `{ createdCwd: resolveAbsoluteCwd(cwd) }` and risking a forgotten
 * `resolveAbsoluteCwd` wrap (see that function's JSDoc for why the
 * resolution itself matters).
 * @param cwd - The `CrawlConfig.cwd` value for this session.
 * @returns A one-field `Partial<Config>` patch.
 */
function buildCreatedCwdPatch(cwd: string): Pick<Config, 'createdCwd'> {
	return { createdCwd: resolveAbsoluteCwd(cwd) };
}

/**
 * Await a filesystem promise but silently swallow only `ENOENT` errors. Any
 * other failure (permissions, disk full, etc.) propagates so the caller can
 * react instead of guessing whether the operation worked.
 * @param promise - Filesystem operation to await.
 */
async function ignoreEnoent(promise: Promise<unknown>): Promise<void> {
	try {
		await promise;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}
}
