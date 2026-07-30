import type {
	BrowserScrapeResult,
	CrawlerEventTypes,
	CrawlerOptions,
	OutageSuspect,
	ResourceLookupResult,
	ScrapeOutcome,
} from './types.js';
import type { PageDataWithDomPaths, PageSource } from '../archive/types.js';
import type {
	ChangePhaseEvent,
	ConsoleLogEntry,
	PageData,
	ResourceEntry,
	ScrapeResult,
} from '@d-zero/beholder';
import type { ExURL } from '@d-zero/shared/parse-url';
import type { Page as PuppeteerPage } from 'puppeteer';

import { existsSync } from 'node:fs';
import path from 'node:path';

import Scraper from '@d-zero/beholder';
import { deal } from '@d-zero/dealer';
import { delay } from '@d-zero/shared/delay';
import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { retryCall } from '@d-zero/shared/retry';
import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';
import c from 'ansi-colors';

import pkg from '../../package.json' with { type: 'json' };
import { computeBodyHash } from '../archive/body-hash/compute-body-hash.js';
import { classifyErrorKind } from '../classify-error-kind.js';
import { crawlerLog } from '../debug.js';

import { buildJsRedirectEdge } from './build-js-redirect-edge.js';
import { buildRedirectEvent } from './build-redirect-event.js';
import { captureImageDomPaths } from './capture-image-dom-paths.js';
import { chooseProbeHost } from './choose-probe-host.js';
import { createChangePhaseHandler } from './create-change-phase-handler.js';
import { computeMetaSignature } from './dedupe/compute-meta-signature.js';
import { computeShapeKey } from './dedupe/compute-shape-key.js';
import DedupeCapTracker from './dedupe/dedupe-cap-tracker.js';
import { isPredictedContentDuplicate } from './dedupe/is-predicted-content-duplicate.js';
import { resolveOgUrlMismatch } from './dedupe/resolve-og-url-mismatch.js';
import { derivePageSource } from './derive-page-source.js';
import { destinationCache } from './destination-cache.js';
import { detectPaginationPattern } from './detect-pagination-pattern.js';
import { dnsBurnedHostBurnTimestamps } from './dns-burned-host-burn-timestamps.js';
import { dnsBurnedHostCache } from './dns-burned-host-cache.js';
import { dnsBurnedHostShortCircuitCounter } from './dns-burned-host-short-circuit-counter.js';
import { drainPhaseErrors } from './drain-phase-errors.js';
import { evictNetworkClassifiedDestinationCacheEntries } from './evict-network-classified-destination-cache-entries.js';
import { evictOutageTaintedDnsBurns } from './evict-outage-tainted-dns-burns.js';
import { fetchDestination } from './fetch-destination.js';
import { findScopeEntry } from './find-scope-entry.js';
import { formatCrawlProgress } from './format-crawl-progress.js';
import { generatePredictedUrls } from './generate-predicted-urls.js';
import { handleBrowserClose } from './handle-browser-close.js';
import { handleIgnoreAndSkip } from './handle-ignore-and-skip.js';
import { handleScrapeEnd } from './handle-scrape-end.js';
import { handleScrapeError } from './handle-scrape-error.js';
import { injectScopeAuth } from './inject-scope-auth.js';
import { isHtmlContentType } from './is-html-content-type.js';
import { isLikelyHtmlUrl } from './is-likely-html-url.js';
import { isPuppeteerFallbackCandidate } from './is-puppeteer-fallback-candidate.js';
import LinkList from './link-list.js';
import { linkToPageData } from './link-to-page-data.js';
import { logUndrainedPhaseErrors } from './log-undrained-phase-errors.js';
import NetworkGate from './network-gate.js';
import NetworkOutageDetector from './network-outage-detector.js';
import { partitionUrlsByHtml } from './partition-urls-by-html.js';
import { planSubResourceEmits } from './plan-sub-resource-emits.js';
import { PreloadShortCircuitError } from './preload-short-circuit-error.js';
import { probeNetwork } from './probe-network.js';
import { protocolAgnosticKey } from './protocol-agnostic-key.js';
import { redirectDestKey } from './redirect-dest-key.js';
import { resourceToPageData } from './resource-to-page-data.js';
import { RobotsChecker } from './robots-checker.js';
import { shouldBurnHost } from './should-burn-host.js';
import { shouldDiscardPredicted } from './should-discard-predicted.js';
import { shouldSkipUrl } from './should-skip-url.js';

export type { CrawlerOptions } from './types.js';

/**
 * Per-attempt HEAD pre-flight timeouts in milliseconds.
 *
 * `retryCall` re-invokes the work function up to `retry + 1` times; we keep
 * the first attempt short so a fast healthy site never pays the slow-server
 * tax, then escalate so that a slow-but-eventually-responsive host gets a
 * larger budget on retry. The attempt index is clamped to the last element
 * of the array, so configurations with `retry > escalation.length - 1` just
 * stay on the final (longest) timeout for any additional attempts.
 */
const HEAD_TIMEOUT_ESCALATION_MS: readonly number[] = [10_000, 30_000, 60_000];

/** Default {@link CrawlerOptions.networkOutageWindowMs}. */
const DEFAULT_NETWORK_OUTAGE_WINDOW_MS = 10_000;
/** Default {@link CrawlerOptions.networkOutageErrorThreshold}. */
const DEFAULT_NETWORK_OUTAGE_ERROR_THRESHOLD = 5;
/** Default {@link CrawlerOptions.networkOutageHostThreshold}. */
const DEFAULT_NETWORK_OUTAGE_HOST_THRESHOLD = 2;
/** Default {@link CrawlerOptions.networkOutageProbeIntervalMs}. */
const DEFAULT_NETWORK_OUTAGE_PROBE_INTERVAL_MS = 10_000;
/** Default {@link CrawlerOptions.dedupeMapCap}. */
const DEFAULT_DEDUPE_MAP_CAP = 100_000;

/**
 * The core crawler engine that discovers and scrapes web pages.
 *
 * The Crawler manages the crawl queue, uses the dealer pattern for concurrent
 * page scraping via `@d-zero/beholder`, handles scrape results, and emits
 * events defined by {@link CrawlerEventTypes}. It supports recursive crawling
 * within a defined scope, external page fetching, URL exclusion, and resumable crawls.
 *
 * Crawling is performed concurrently using the dealer pattern, with
 * configurable parallelism up to {@link Crawler.MAX_PROCESS_LENGTH}.
 */
export default class Crawler extends EventEmitter<CrawlerEventTypes> {
	/** Controller used to cancel the deal-based crawl via its AbortSignal. */
	readonly #abortController = new AbortController();
	/**
	 * Per-shape count of anchors rejected by the dedupe-cap enqueue gates
	 * after that shape capped. Read by {@link getDedupeCapRejections} at
	 * `crawlEnd` so the orchestrator can finalize each
	 * `dedupe_cap_events.rejected_count` exactly once (see
	 * `Crawler#getDedupeCapRejections`'s JSDoc for why this is not written
	 * to the archive incrementally).
	 */
	readonly #dedupeCapRejectionCounts = new Map<string, number>();
	/**
	 * Opt-in (`--dedupe-cap`) same-cluster soft cap. Always constructed
	 * (Misra-Gries state stays empty when {@link CrawlerOptions.dedupeCap} is
	 * `null`), gated on by `#options.dedupeCap !== null` at each call site
	 * rather than being conditionally `undefined`, so the two enqueue gates
	 * and the observation call in {@link #handleResult} do not need to
	 * null-check a class field.
	 */
	readonly #dedupeCapTracker: DedupeCapTracker;

	/** Tracks discovered URLs, their scrape status, and deduplication. */
	readonly #linkList = new LinkList();
	/**
	 * Gate every worker callback awaits before doing network work (see the
	 * worker body inside {@link #runDeal}). Open by default; closed by
	 * {@link #handleOutageSuspect} once a recovery probe confirms a suspect
	 * outage, reopened once a later probe succeeds. Re-opened defensively at
	 * the start of {@link #runDeal} (a no-op if already open) so a fresh
	 * session never inherits a closed gate from a prior anomalous one.
	 */
	readonly #networkGate = new NetworkGate();
	/**
	 * Sliding-window detector for "the operator's own network, not the
	 * target sites, looks like it is down". Fed from {@link #sendHeadRequest}'s
	 * `onWait` / `onGiveUp`; a non-null {@link OutageSuspect} triggers
	 * {@link #handleOutageSuspect}. Reset at the start of {@link #runDeal}.
	 * Assigned in the constructor (not a field initializer) because it
	 * needs `this.#options`'s network-outage tunables.
	 */
	readonly #networkOutageDetector: NetworkOutageDetector;
	/** Merged crawler configuration (user overrides + defaults). */
	readonly #options: CrawlerOptions;
	/**
	 * Synchronous claim flag guarding the async gap between "a suspect
	 * outage arrived" and "the confirming probe settled" in
	 * {@link #handleOutageSuspect}. Without it, two workers whose HEAD
	 * requests both exhaust retries in quick succession could each start
	 * their own confirming probe while the gate is still open, and if both
	 * probes fail, both would close the gate and emit
	 * `networkOutageConfirmed` — creating two simultaneously-open
	 * `network_outages` rows for one ongoing outage. Checked and set
	 * synchronously (no `await` between the check and the set), which is
	 * race-free because JS has no thread-level interleaving.
	 */
	#outageHandlingInProgress = false;
	/**
	 * Phase errors observed during {@link Crawler._launchBrowserAndScrape},
	 * buffered per URL href so they can be emitted as `pageError` events
	 * AFTER the corresponding `page` / `externalPage` event. This ordering
	 * lets the orchestrator's WriteQueue serialise `setPage` before
	 * `insertPageError`, so the FK resolution via URL always finds the row.
	 */
	readonly #pendingPhaseErrors = new Map<
		string /* url.href */,
		{ phase: string; message: string }[]
	>();
	/**
	 * Predicted-pagination body-hash tracking (always-on — independent of
	 * the opt-in `--dedupe-cap` tracker). Maps a URL shape key
	 * ({@link computeShapeKey}) to the {@link computeBodyHash} of the most
	 * recently scraped *predicted* page of that shape. Never reset mid-crawl
	 * (persists for the whole session, like {@link #scrapedDestinations}).
	 */
	readonly #predictedShapeBodyHashes = new Map<string, Buffer>();
	/**
	 * Shapes for which {@link #predictedShapeBodyHashes} detected a
	 * content-duplicate predicted page (see {@link isPredictedContentDuplicate}).
	 * Once a shape lands here, no further predicted URLs are generated for it
	 * (checked in {@link #handleResult}'s pagination-pattern branch) — the
	 * cheapest possible way to stop a self-generating trap without needing
	 * the opt-in dedupe-cap machinery.
	 */
	readonly #predictedShapeStopped = new Set<string>();
	/** Set of resource URLs (without hash) already captured, for deduplication. */
	readonly #resources = new Set<string>();
	/** Number of HTML pages (isTarget=1) scraped in previous sessions, used to seed the progress counter on resume. */
	#resumedPagesScraped = 0;
	/** URLs restored from a previous session that still need to be scraped. */
	#resumedPending: ExURL[] = [];
	/** URLs already scraped in a previous session, used to populate the `seen` set in {@link #runDeal}. */
	#resumedScraped: string[] = [];
	/** Checker for robots.txt compliance. */
	readonly #robotsChecker: RobotsChecker;
	/** Maps hostnames to their scope URLs. Defines the crawl boundary for internal/external classification. */
	readonly #scope = new Map<string /* hostname */, ExURL[]>();
	/**
	 * Protocol-agnostic keys of redirect destinations already rendered (and stored)
	 * during this crawl. When many URLs redirect to one destination, only the first
	 * renders it; the rest record the redirect edge and skip the browser (#73).
	 * Keyed by {@link redirectDestKey}. Reset at the start of {@link #runDeal}.
	 */
	readonly #scrapedDestinations = new Set<string>();

	/**
	 * Lower-cased hostnames for which at least one URL has returned an
	 * HTTP response (any status) via `fetchDestination` in this session.
	 * Consulted by {@link shouldBurnHost} as the cascade guard against
	 * "transient local DNS hiccup wipes out a healthy host": a host that
	 * responded earlier is treated as still alive even when the next URL on
	 * it exhausts retries with a `getaddrinfo ENOTFOUND`, since the most
	 * likely cause is the operator's resolver flipping mid-crawl rather than
	 * the host suddenly disappearing. Populated by {@link #sendHeadRequest}
	 * on the success path; reset at the start of {@link #runDeal} alongside
	 * {@link #scrapedDestinations} so a fresh session does not inherit
	 * stale liveness assumptions.
	 */
	readonly #successfulHosts = new Set<string>();

	/**
	 * The AbortSignal associated with this crawler's AbortController.
	 *
	 * Passed to `deal()` so that it stops launching new workers after abort.
	 * Also available to the orchestrator for forwarding to other subsystems.
	 */
	get signal(): AbortSignal {
		return this.#abortController.signal;
	}

	/**
	 * Create a new Crawler instance.
	 * @param options - Configuration options for crawling behavior. All fields have
	 *   sensible defaults if omitted.
	 */
	constructor(options?: Partial<CrawlerOptions>) {
		super();
		this.#options = {
			interval: options?.interval || 0,
			parallels: options?.parallels || 0,
			recursive: options?.recursive ?? true,
			fromList: false,
			captureImages: options?.captureImages ?? true,
			executablePath: options?.executablePath ?? null,
			fetchExternal: options?.fetchExternal ?? true,
			roots: options?.roots ?? [],
			excludes: options?.excludes || [],
			excludeKeywords: options?.excludeKeywords || [],
			excludeUrls: options?.excludeUrls || [],
			maxExcludedDepth: options?.maxExcludedDepth || 10,
			retry: options?.retry ?? 3,
			disableQueries: options?.disableQueries ?? false,
			verbose: options?.verbose ?? false,
			userAgent: options?.userAgent || `Nitpicker/${pkg.version}`,
			ignoreRobots: options?.ignoreRobots ?? false,
			mainContentSelector: options?.mainContentSelector ?? null,
			lookupResource: options?.lookupResource ?? null,
			lookupPageSource: options?.lookupPageSource ?? null,
			inventoryMode: options?.inventoryMode ?? null,
			networkOutageWindowMs:
				options?.networkOutageWindowMs ?? DEFAULT_NETWORK_OUTAGE_WINDOW_MS,
			networkOutageErrorThreshold:
				options?.networkOutageErrorThreshold ?? DEFAULT_NETWORK_OUTAGE_ERROR_THRESHOLD,
			networkOutageHostThreshold:
				options?.networkOutageHostThreshold ?? DEFAULT_NETWORK_OUTAGE_HOST_THRESHOLD,
			networkOutageProbeIntervalMs:
				options?.networkOutageProbeIntervalMs ?? DEFAULT_NETWORK_OUTAGE_PROBE_INTERVAL_MS,
			networkProbe: options?.networkProbe ?? null,
			dedupeCap: options?.dedupeCap ?? null,
			dedupeMapCap: options?.dedupeMapCap ?? DEFAULT_DEDUPE_MAP_CAP,
			preloadedStickyShapeKeys: options?.preloadedStickyShapeKeys ?? [],
		};

		this.#networkOutageDetector = new NetworkOutageDetector({
			windowMs: this.#options.networkOutageWindowMs,
			errorThreshold: this.#options.networkOutageErrorThreshold,
			hostThreshold: this.#options.networkOutageHostThreshold,
		});

		this.#dedupeCapTracker = new DedupeCapTracker(
			{ cap: this.#options.dedupeCap ?? 0, mapCap: this.#options.dedupeMapCap },
			this.#options.preloadedStickyShapeKeys,
		);

		this.#robotsChecker = new RobotsChecker(
			this.#options.userAgent,
			!this.#options.ignoreRobots,
		);

		for (const urlStr of this.#options.roots) {
			const url = parseUrl(urlStr, this.#options);
			if (url) {
				const existing = this.#scope.get(url.hostname) || [];
				this.#scope.set(url.hostname, [...existing, url]);
			}
		}
	}

	/**
	 * Abort the current crawl operation.
	 *
	 * Signals the AbortController so that the dealer stops launching new
	 * workers. Currently running workers will finish, after which `deal()`
	 * resolves and `crawlEnd` is emitted by the normal completion path in
	 * {@link #runDeal}.
	 */
	abort() {
		this.#abortController.abort();
	}

	/**
	 * Per-shape count of anchors the dedupe-cap enqueue gates rejected after
	 * that shape capped (opt-in `--dedupe-cap`). Read by
	 * `CrawlerOrchestrator` at `crawlEnd` to finalize each
	 * `dedupe_cap_events.rejected_count` exactly once — rejections are
	 * accumulated in memory rather than written to the archive per-rejection
	 * to avoid write amplification (a capped trap can generate an unbounded
	 * number of rejected anchors).
	 * @returns A snapshot of the per-shape rejection counts. Empty when
	 *   `--dedupe-cap` was not enabled or no shape has capped yet.
	 */
	getDedupeCapRejections(): ReadonlyMap<string, number> {
		return this.#dedupeCapRejectionCounts;
	}
	/**
	 * Retrieve the list of Chromium process IDs that are still running.
	 *
	 * In the current architecture, process cleanup is handled by the dealer,
	 * so this always returns an empty array.
	 * @returns An empty array (reserved for future use).
	 */
	getUndeadPid() {
		return [];
	}

	/**
	 * Restore crawl state from a previous session for resumable crawling.
	 *
	 * Repopulates the link list with pending and already-scraped URLs,
	 * and restores the set of known resource URLs to avoid duplicates.
	 * @param pending - URLs that were pending (not yet scraped) in the previous session.
	 * @param scraped - URLs that were already scraped in the previous session.
	 * @param resources - Resource URLs that were already captured in the previous session.
	 * @param pagesScrapedOffset - Number of HTML pages already rendered in previous
	 *   sessions, used to seed the session-spanning progress counter. Defaults to 0
	 *   for callers that don't need cross-session accuracy in the progress display.
	 */
	resume(
		pending: string[],
		scraped: string[],
		resources: string[],
		pagesScrapedOffset = 0,
	) {
		this.#resumedPending = this.#linkList.resume(pending, scraped, this.#options);
		this.#resumedScraped = scraped;
		this.#resumedPagesScraped = pagesScrapedOffset;
		for (const resource of resources) {
			this.#resources.add(resource);
		}
	}

	/**
	 * Start crawling from one or more root URLs.
	 *
	 * Each URL is registered as a scope entry (if not already present) and added
	 * to the link list. When `opts.recursive` is `false`, recursion is disabled
	 * and the crawler behaves like the former `startMultiple` (list mode);
	 * otherwise discovered child pages within the scope are followed.
	 *
	 * When resume state is present, the resumed pending URLs are merged with the
	 * newly-provided roots. The merge is deduplicated by protocol-agnostic key
	 * before reaching the dealer so a URL that exists in both sources — which
	 * is common in append-mode when a new root coincides with a repromoted
	 * previously-external page — does not race on two parallel slots.
	 * @param urls - The list of root URLs to begin crawling from. May be empty
	 *   when resumed pending URLs already exist (for example `--retry-failed`).
	 * @param opts - Optional overrides; currently only `recursive` is honoured.
	 * @param opts.recursive - When `false`, disables recursive discovery and forces list-mode.
	 *   Defaults to the constructor option's `recursive` value.
	 * @throws {Error} If the URL list is empty.
	 */
	start(urls: ExURL[], opts?: { recursive?: boolean }) {
		// Inventory mode pre-loads tens of thousands of seed URLs that all
		// fall under archived `roots` (already populated into `#scope` by
		// the constructor). Adding each seed as its own scope entry was
		// O(N²) on build (per-host `existing.some` + array spread) AND
		// turned every later `findScopeEntry` into a 70k linear scan. Skip
		// the scope add — seeds remain entry points via `#linkList`.
		const skipScopeAdd = this.#options.inventoryMode != null;
		for (const url of urls) {
			if (!skipScopeAdd) {
				const existing = this.#scope.get(url.hostname) || [];
				if (!existing.some((u) => u.href === url.href)) {
					this.#scope.set(url.hostname, [...existing, url]);
				}
			}
			this.#linkList.add(url);
		}

		const recursive = opts?.recursive ?? this.#options.recursive;
		if (!recursive) {
			this.#options.recursive = false;
			this.#options.fromList = true;
		}

		// A resume can have an empty scraped set — e.g. a crawl interrupted before
		// any page finished, or a `--retry-failed` run where every page in the
		// archive was a failure and got reset to pending. Keying purely on
		// `#resumedScraped` would then mistake the session for a fresh crawl and
		// drop every resumed pending URL, so honour the pending set too.
		const isResuming = this.#resumedScraped.length > 0 || this.#resumedPending.length > 0;
		// Dedupe by the same protocol-agnostic key the dealer uses internally.
		// Append-mode in particular can put the same URL into both
		// `#resumedPending` (via `repromoteExternalPages`) and `urls` (the
		// new root); without this dedupe both copies would grab a parallel
		// slot and race on the same URL.
		const seenInitial = new Set<string>();
		const initialUrls: ExURL[] = [];
		for (const url of isResuming ? [...this.#resumedPending, ...urls] : urls) {
			const key = protocolAgnosticKey(url.withoutHashAndAuth);
			if (seenInitial.has(key)) continue;
			seenInitial.add(key);
			initialUrls.push(url);
		}
		const root = initialUrls[0];
		if (!root) {
			if (isResuming) {
				crawlerLog('Crawl End (nothing to resume)');
				void this.emit('crawlEnd', {});
				return;
			}
			throw new Error('urls is empty');
		}
		const resumeOffset = this.#resumedScraped.length;
		const pagesScrapedOffset = this.#resumedPagesScraped;

		void this.#runDeal(initialUrls, resumeOffset, pagesScrapedOffset).catch((error) => {
			crawlerLog('runDeal error: %O', error);
			this.#emitDealErrors(error, root.href);
			void this.emit('crawlEnd', {});
		});
	}

	/**
	 * Thin instance-bound adapter over {@link drainPhaseErrors}. Flushes
	 * `#pendingPhaseErrors` for `url` as `pageError` events. Idempotent.
	 *
	 * **Test gap (known)**: this adapter is invoked from the worker body in
	 * {@link Crawler.#runDeal} at three call sites — after `#handleResult`,
	 * inside the worker's `catch`, and via `logUndrainedPhaseErrors` in
	 * `finally`. The drain logic itself is unit-tested in
	 * `drain-phase-errors.spec.ts`; the wiring (whether the worker actually
	 * calls it on each path) is verified by code review only, because
	 * driving the worker requires a Puppeteer + beholder mock stack whose
	 * cost outweighs the regression it would catch.
	 * @param url - URL whose buffered errors should be flushed.
	 * @param isExternal - Whether the URL is external to the crawl scope.
	 */
	#drainPhaseErrors(url: ExURL, isExternal: boolean): void {
		drainPhaseErrors(this.#pendingPhaseErrors, url.href, isExternal, (payload) => {
			void this.emit('pageError', payload);
		});
	}
	/**
	 * Emits error events for a deal-level failure.
	 *
	 * When the dealer rejects with an `AggregateError` (e.g. multiple worker
	 * failures), each inner error is emitted as a separate `error` event.
	 * For any other error type, a single `error` event is emitted.
	 * @param error - The error thrown by `#runDeal`.
	 * @param fallbackUrl - URL string used as the error context (typically the root URL).
	 */
	#emitDealErrors(error: unknown, fallbackUrl: string) {
		const errors =
			error instanceof AggregateError ? (error.errors as unknown[]) : [error];

		for (const e of errors) {
			void this.emit('error', {
				pid: process.pid,
				isMainProcess: true,
				url: fallbackUrl,
				isExternal: false,
				error: e instanceof Error ? e : new Error(String(e)),
			});
		}
	}

	/**
	 * Emits captured console messages / page errors for a scrape (issue
	 * #228), skipping the emit entirely when `entries` is empty.
	 *
	 * The empty-skip is deliberate, not an optimization: `replaceConsoleLogs`
	 * replaces a page's rows wholesale (Scoped-Replace, like
	 * `anchor_edges` / `image_items`), so emitting on an empty capture would
	 * wipe out a prior good result on a degraded re-scrape (navigation
	 * timeout, partial render) that legitimately produced nothing this
	 * time — the same trade-off `updatePage` documents for anchors/images.
	 * @param entries - Console log entries captured during the page load.
	 * @param url - The originally-requested URL (not necessarily the page
	 *   that ends up holding the content — see `CrawlerEventTypes.consoleLogs`).
	 * @param redirectPaths - The redirect chain hops captured during fetch,
	 *   in order. Empty when the scrape produced no `pageData` (a
	 *   `'skipped'` / `'error'` result).
	 */
	#handleConsoleLogs(
		entries: ConsoleLogEntry[],
		url: ExURL,
		redirectPaths: readonly string[],
	) {
		if (entries.length === 0) {
			return;
		}
		void this.emit('consoleLogs', {
			pageUrl: url.withoutHashAndAuth,
			redirectPaths,
			entries,
		});
	}
	/**
	 * Confirm a sliding-window suspect via an active probe, and if
	 * confirmed, close {@link #networkGate} and start
	 * {@link #runRecoveryProbeLoop}.
	 *
	 * Guarded by {@link #outageHandlingInProgress} (a synchronous
	 * check-then-set, race-free under JS's single-threaded execution) AND
	 * by `#networkGate.isOpen` — the latter covers the entire duration a
	 * recovery loop is running (no new suspect should re-confirm or
	 * re-probe while one outage is already open), the former covers only
	 * the narrow async gap between "decided to investigate" and "the
	 * confirming probe settled", which the gate-open check alone cannot see
	 * since the gate has not closed yet at that point.
	 * @param suspect - The trigger emitted by {@link NetworkOutageDetector.record}.
	 */
	async #handleOutageSuspect(suspect: OutageSuspect): Promise<void> {
		if (!this.#networkGate.isOpen || this.#outageHandlingInProgress) {
			return;
		}
		this.#outageHandlingInProgress = true;
		try {
			// No usable probe target at all (no session successes yet AND no
			// parseable root URL) — cannot confirm, and cannot ever detect
			// recovery either, so there is nothing safe to do but leave the
			// gate open and treat this as inconclusive.
			const probeHost = chooseProbeHost(this.#successfulHosts, this.#options.roots);
			if (probeHost === null) {
				return;
			}

			const probe = this.#options.networkProbe ?? probeNetwork;
			const initiallyReachable = await probe(probeHost);
			if (initiallyReachable) {
				// False alarm: the sliding window tripped (e.g. several
				// unrelated hosts happened to fail close together) but the
				// probe host answers fine. Leave the gate open.
				return;
			}

			this.#networkGate.close();
			void this.emit('networkOutageConfirmed', {
				startedAt: suspect.startedAt,
				detectedAt: suspect.detectedAt,
				probeHost,
				triggerErrorCount: suspect.triggerErrorCount,
				triggerHostCount: suspect.triggerHostCount,
			});
			void this.#runRecoveryProbeLoop(probeHost, suspect.startedAt);
		} finally {
			this.#outageHandlingInProgress = false;
		}
	}
	/**
	 * Processes captured sub-resources from a page scrape, deduplicates them,
	 * and emits `response` / `responseReferrers` events for new resources.
	 * @param resources - Sub-resource entries captured during the page load
	 * @param parentSource
	 */
	#handleResources(resources: ResourceEntry[], parentSource: PageSource | undefined) {
		// Decide the full emit plan first via the pure planner — that lets
		// the lineage propagation contract (parent source → sub-resource
		// `source`) be unit-tested in `plan-sub-resource-emits.spec.ts`
		// without spinning up the puppeteer stack here. The previous
		// inline shape made the `source` value invisible to tests because
		// emit() side effects were only observable via a full scrape run
		// that requires a mocked Chromium instance.
		const { responseEmits, referrerEmits } = planSubResourceEmits(
			resources,
			parentSource,
			this.#resources,
		);
		for (const payload of responseEmits) {
			void this.emit('response', payload);
		}
		for (const payload of referrerEmits) {
			void this.emit('responseReferrers', payload);
		}
	}

	/**
	 * Dispatches a scrape result to the appropriate handler based on its type.
	 *
	 * - `success`: Processes anchors, enqueues new URLs, triggers predicted
	 *   pagination detection, and emits `page` / `externalPage` events.
	 * - `skipped`: Marks the URL as done and emits `skip`.
	 * - `error`: Creates a fallback PageData, marks as done, and emits `error`.
	 * @param result - The scrape result from beholder
	 * @param url - The URL that was scraped
	 * @param enqueue - Callback to enqueue newly discovered URLs into the dealer
	 *   queue, prioritising likely-HTML URLs to the front (see {@link partitionUrlsByHtml}).
	 *   Accepts a batch so a group of URLs (e.g. predicted pagination) keeps its order.
	 * @param concurrency - Current concurrency level, used to determine predicted URL count
	 */
	#handleResult(
		result: ScrapeResult,
		url: ExURL,
		enqueue: (...urls: ExURL[]) => Promise<void>,
		concurrency?: number,
	) {
		switch (result.type) {
			case 'success': {
				if (!result.pageData) break;
				// Scoped to this one page's anchor list (fresh per `#handleResult`
				// call, not shared across pages): pagination-pattern detection
				// compares consecutive anchors as they are discovered by
				// `processAnchors`'s single synchronous loop below, so "consecutive"
				// must mean "adjacent in this document", not "adjacent in whatever
				// order the crawl's workers happened to finish". Sharing this state
				// across pages/workers let `step` be computed from two unrelated
				// URLs, compounding across rounds until a `/news/date/{year}/`
				// pager's predicted token overflowed into scientific notation
				// (`1.7715854126052197e+120`, observed in production).
				const paginationState: {
					lastPushedUrl: string | null;
					lastPushedWasPredicted: boolean;
				} = {
					lastPushedUrl: null,
					lastPushedWasPredicted: false,
				};

				// Feed this page's own signature into the same-cluster tracker
				// (opt-in via `--dedupe-cap`). This is deliberately separate
				// from the enqueue gates below: gating decides whether to
				// admit a not-yet-scraped anchor based on shape alone; this
				// observes the page that was JUST scraped, using its actual
				// meta/body content. External and metadata-only pages carry no
				// useful signal for this feature and are skipped, matching the
				// signature-scope exclusions in `computeMetaSignature`'s design.
				if (
					this.#options.dedupeCap !== null &&
					!result.pageData.isExternal &&
					!this.#linkList.isMetadataOnly(result.pageData.url.withoutHash) &&
					result.pageData.html.length > 0
				) {
					const shapeKey = computeShapeKey(result.pageData.url.withoutHashAndAuth);
					const metaSig = computeMetaSignature(result.pageData.meta);
					if (shapeKey && metaSig) {
						const bodyHash = computeBodyHash(result.pageData.html);
						const ogUrlMismatch = resolveOgUrlMismatch(
							result.pageData.meta,
							result.pageData.url.href,
						);
						const event = this.#dedupeCapTracker.observe({
							shapeKey,
							metaSig,
							bodyHash,
							ogUrlMismatch,
							url: result.pageData.url.href,
						});
						if (event) {
							void this.emit('dedupeCap', event);
						}
					}
				}

				handleScrapeEnd(
					result.pageData,
					this.#linkList,
					this.#scope,
					this.#options,
					(newUrl, opts) => {
						// Gate 1: blocks real anchors discovered on this page whose
						// shape is already confirmed as a trap. This does NOT cover
						// predicted URLs — `generatePredictedUrls`'s output is
						// pushed directly below (`this.#linkList.add(specUrl, ...)`),
						// bypassing this closure entirely — so the predicted-URL
						// generation site below has its own equivalent check
						// (`shapeIsStopped`, combined with `#predictedShapeStopped`).
						// External / metadata-only anchors are out of scope for the
						// cap (issue #208: "cap 適用は internal only").
						if (
							this.#options.dedupeCap !== null &&
							!opts?.metadataOnly &&
							findScopeEntry(newUrl, this.#scope, this.#options) !== null
						) {
							const gateShapeKey = computeShapeKey(newUrl.withoutHashAndAuth);
							if (gateShapeKey && this.#dedupeCapTracker.isCapped(gateShapeKey)) {
								this.#recordDedupeCapRejection(gateShapeKey);
								return;
							}
						}

						this.#linkList.add(newUrl, opts);
						void enqueue(newUrl);

						// Predicted pagination detection
						if (!concurrency) return;

						// metadataOnly / external: update tracking but skip pattern detection
						if (
							opts?.metadataOnly ||
							findScopeEntry(newUrl, this.#scope, this.#options) === null
						) {
							paginationState.lastPushedUrl = newUrl.withoutHashAndAuth;
							paginationState.lastPushedWasPredicted = false;
							return;
						}

						// Skip comparison when last push was predicted (cascade prevention)
						if (
							paginationState.lastPushedUrl &&
							!paginationState.lastPushedWasPredicted
						) {
							const pattern = detectPaginationPattern(
								paginationState.lastPushedUrl,
								newUrl.withoutHashAndAuth,
							);
							if (pattern) {
								// Stop generating further predicted URLs for this shape
								// once EITHER confirmation mechanism has fired — the
								// always-on content-duplication check
								// (`#predictedShapeStopped`), or the opt-in
								// `--dedupe-cap` tracker (`#dedupeCapTracker.isCapped`,
								// only consulted when the flag is set). Falls through to
								// the plain (non-predicted) bookkeeping below instead of
								// returning, since the anchor itself is still real.
								const shapeKey = computeShapeKey(newUrl.withoutHashAndAuth);
								const shapeIsStopped =
									shapeKey !== null &&
									(this.#predictedShapeStopped.has(shapeKey) ||
										(this.#options.dedupeCap !== null &&
											this.#dedupeCapTracker.isCapped(shapeKey)));
								if (!shapeIsStopped) {
									const urls = generatePredictedUrls(
										pattern,
										newUrl.withoutHashAndAuth,
										concurrency,
									);
									const specUrls: ExURL[] = [];
									for (const specUrlStr of urls) {
										const specUrl = parseUrl(specUrlStr, this.#options);
										if (specUrl) {
											this.#linkList.add(specUrl, { predicted: true });
											specUrls.push(specUrl);
										}
									}
									// Enqueue as one batch so ascending page order is kept
									// at the front of the queue (see enqueue in #runDeal).
									if (specUrls.length > 0) void enqueue(...specUrls);
									paginationState.lastPushedUrl = newUrl.withoutHashAndAuth;
									paginationState.lastPushedWasPredicted = true;
									return;
								}
							}
						}

						paginationState.lastPushedUrl = newUrl.withoutHashAndAuth;
						paginationState.lastPushedWasPredicted = false;
					},
				);
				{
					const pageSource = derivePageSource(
						this.#options.inventoryMode,
						result.pageData.url.withoutHashAndAuth,
					);
					if (result.pageData.isExternal) {
						void this.emit('externalPage', {
							result: result.pageData,
							source: pageSource,
						});
					} else {
						void this.emit('page', {
							result: result.pageData,
							source: pageSource,
						});
					}
				}
				break;
			}
			case 'skipped': {
				if (!result.ignored) break;
				handleIgnoreAndSkip(
					result.ignored.url,
					this.#linkList,
					this.#scope,
					this.#options,
				);
				void this.emit('skip', {
					url: result.ignored.url.href,
					reason: JSON.stringify(result.ignored),
					isExternal:
						findScopeEntry(result.ignored.url, this.#scope, this.#options) === null,
				});
				break;
			}
			case 'error': {
				if (!result.error) break;
				const error = new Error(result.error.message);
				error.name = result.error.name;
				error.stack = result.error.stack;
				const { result: pageResult } = handleScrapeError(
					{
						url,
						error,
						shutdown: result.error.shutdown,
						pid: undefined,
					},
					this.#linkList,
					this.#scope,
					this.#options,
				);
				const isExternal = findScopeEntry(url, this.#scope, this.#options) === null;
				if (pageResult) {
					const pageSource = derivePageSource(
						this.#options.inventoryMode,
						pageResult.url.withoutHashAndAuth,
					);
					if (pageResult.isExternal) {
						void this.emit('externalPage', {
							result: pageResult,
							source: pageSource,
						});
					} else {
						void this.emit('page', { result: pageResult, source: pageSource });
					}
				}
				void this.emit('error', {
					pid: process.pid,
					isMainProcess: true,
					url: url.href,
					isExternal,
					error,
				});
				break;
			}
		}
	}
	/**
	 * Undo cache damage from the outage window `[startedAt, endedAt]`:
	 * evict `destinationCache` entries whose cached error looks
	 * network-related (any such entry may be stale evidence about the
	 * operator's network, not the target site), and un-burn any
	 * `dnsBurnedHostCache` host THIS session burned during that window
	 * (preload-seeded burns are structurally immune — see
	 * `evict-outage-tainted-dns-burns.ts`).
	 *
	 * Called on every closed→open gate transition, whether triggered by a
	 * successful recovery probe or by an abort — the cached failures are
	 * stale either way, and the eviction itself has no failure mode that
	 * depends on why the gate reopened.
	 * @param startedAt - The outage's `startedAt` (from the triggering `OutageSuspect`).
	 * @param endedAt - The moment the gate is reopening.
	 */
	#onGateReopened(startedAt: number, endedAt: number): void {
		evictNetworkClassifiedDestinationCacheEntries(destinationCache);
		evictOutageTaintedDnsBurns({
			cache: dnsBurnedHostCache,
			burnTimestamps: dnsBurnedHostBurnTimestamps,
			window: { startedAt, endedAt },
		});
	}
	/**
	 * Increments {@link #dedupeCapRejectionCounts} for one shape. Scoped to
	 * the two concrete enqueue-time rejections (a real anchor or a
	 * JS-redirect destination that was discovered but blocked) — it does
	 * NOT count predicted URLs that were never generated at all because
	 * their shape was already stopped (see the `shapeIsStopped` check in
	 * {@link #handleResult}), since nothing concrete existed there to
	 * reject.
	 * @param shapeKey - The capped shape a rejection is being recorded for.
	 */
	#recordDedupeCapRejection(shapeKey: string): void {
		this.#dedupeCapRejectionCounts.set(
			shapeKey,
			(this.#dedupeCapRejectionCounts.get(shapeKey) ?? 0) + 1,
		);
	}
	/**
	 * Feed one observed network-layer error into
	 * {@link #networkOutageDetector} and hand off to
	 * {@link #handleOutageSuspect} the instant its sliding window trips.
	 *
	 * Called from BOTH `onWait` (every non-final retry attempt) and
	 * `onGiveUp` (the final attempt) inside {@link #sendHeadRequest}, so a
	 * single URL's retry storm contributes every attempt's error, not just
	 * its terminal one — a real network-wide outage is expected to trip the
	 * `hostThreshold` gate from many DIFFERENT hosts' attempts arriving in
	 * the same short window, not from one URL retrying against one host.
	 * @param message - The raw error message to classify.
	 * @param host - Lower-cased hostname the error occurred on.
	 */
	#recordNetworkError(message: string, host: string): void {
		const suspect = this.#networkOutageDetector.record({
			kind: classifyErrorKind(message),
			host,
			at: Date.now(),
		});
		if (suspect) {
			void this.#handleOutageSuspect(suspect);
		}
	}

	/**
	 * Resolve the source label of the page being scraped so sub-resources
	 * captured during its render can inherit the correct lineage label
	 * (`'inventory-discovered'` when the parent is in the inventory chain,
	 * `undefined` otherwise so the DB DEFAULT `'crawled'` lands).
	 *
	 * Two-stage resolution:
	 *
	 * 1. If `inventoryMode` is active (live `--inventory` session), use
	 *    `derivePageSource` directly — the in-memory seed set is the
	 *    authoritative answer and no DB round-trip is needed.
	 *
	 * 2. Otherwise (`--resume`, `--retry-failed`, `--append`, or a normal
	 *    `crawl` of a previously-inventoried archive), ask the injected
	 *    `lookupPageSource` callback. The orchestrator wires that callback
	 *    to `Archive.getPageSourceByUrl` so the parent's lineage from
	 *    earlier sessions survives across sessions.
	 *
	 * One round-trip per page render at most — the result is not memoised
	 * because each worker scrapes a single page per `#scrapePage` call
	 * and the cost is amortised across every sub-resource of that page.
	 * @param url - The URL of the page being scraped.
	 * @returns The parent page's source, or `undefined` when none applies.
	 */
	async #resolveParentSource(url: ExURL): Promise<PageSource | undefined> {
		const fromInventoryMode = derivePageSource(
			this.#options.inventoryMode,
			url.withoutHashAndAuth,
		);
		if (fromInventoryMode !== undefined) {
			return fromInventoryMode;
		}
		const lookupPageSource = this.#options.lookupPageSource;
		if (!lookupPageSource) {
			return undefined;
		}
		try {
			return await lookupPageSource(url.withoutHashAndAuth);
		} catch (error) {
			// A lookup failure must never be worse than not having lineage
			// — fall back to undefined so the sub-resources land at the DB
			// DEFAULT `'crawled'` rather than crashing the whole worker.
			crawlerLog('Parent source lookup failed for %s: %O', url.href, error);
			return undefined;
		}
	}
	/**
	 * Runs the deal-based concurrent crawl loop.
	 *
	 * WHY deal(): The `@d-zero/dealer` pattern provides concurrent item processing
	 * with a dynamic queue — new URLs discovered during scraping are pushed via the
	 * `push` callback and automatically scheduled. The `onPush` deduplication ensures
	 * each URL is processed at most once (protocol-agnostic comparison).
	 * @param initialUrls - Starting URLs to seed the deal queue
	 * @param resumeOffset - Number of URLs already scraped in a previous session,
	 *   added to the progress counter for accurate display
	 * @param pagesScrapedOffset - Number of HTML pages already rendered in previous
	 *   sessions, used to seed the per-session HTML-pages counter so the display
	 *   remains accurate across resumes
	 */
	async #runDeal(initialUrls: ExURL[], resumeOffset = 0, pagesScrapedOffset = 0) {
		const seen = new Set<string>(
			initialUrls.map((u) => protocolAgnosticKey(u.withoutHashAndAuth)),
		);

		// Add scraped URLs to seen to prevent re-processing during resume
		for (const url of this.#resumedScraped) {
			seen.add(protocolAgnosticKey(url));
		}

		// Redirect-destination dedup is per-crawl; clear any state from a prior run.
		this.#scrapedDestinations.clear();
		// Session-liveness signal is per-crawl too; clear so a fresh session
		// does not inherit "host alive" claims from a prior run that may have
		// happened on an entirely different network.
		this.#successfulHosts.clear();
		// Network-outage state is per-crawl too: a sliding window of errors
		// (or a gate left closed) from a prior run on this same `Crawler`
		// instance must not leak into a fresh session. `#networkGate.open()`
		// is a no-op if already open.
		this.#networkOutageDetector.reset();
		this.#networkGate.open();

		// external URL の追跡（target は deal の total/done から導出）
		const externalUrls = new Set<string>();
		const externalDoneUrls = new Set<string>();

		// HTML ページとしてブラウザでレンダリングし、かつアーカイブに保存されたページ数。
		// HEAD のみ・title 取得のみ・skip・ブラウザ起動失敗・predicted-discard は含まない。
		// 過去セッションぶんは pagesScrapedOffset として init される。
		let pagesScraped = pagesScrapedOffset;

		// 初期 URL を分類（onPush を通らないため）
		for (const url of initialUrls) {
			if (findScopeEntry(url, this.#scope, this.#options) === null) {
				externalUrls.add(protocolAgnosticKey(url.withoutHashAndAuth));
			}
		}

		const concurrency = this.#options.parallels
			? Math.max(this.#options.parallels, 1)
			: Crawler.MAX_PROCESS_LENGTH;

		await deal(
			initialUrls,
			(url, update, _index, setLineHeader, push, unshift) => {
				const matchedScope = findScopeEntry(url, this.#scope, this.#options);
				const isExternal = matchedScope === null;
				const urlText = isExternal ? c.dim(url.href) : c.cyan(url.href);
				setLineHeader(`%braille% ${urlText}: `);
				if (matchedScope) {
					injectScopeAuth(url, matchedScope);
				}
				this.#linkList.add(url);
				this.#linkList.progress(url);

				// Likely-HTML URLs jump to the front of the queue (unshift) so page
				// crawling advances ahead of asset/document fetches; everything else
				// is appended (push). partitionUrlsByHtml splits the batch by the
				// URL-only heuristic. Variadic so a batch (e.g. predicted pagination)
				// keeps its order: a single unshift(...html) preserves ascending order
				// at the front, whereas unshifting one-by-one would reverse it.
				const enqueue = (...newUrls: ExURL[]): Promise<void> => {
					const [html, other] = partitionUrlsByHtml(newUrls);
					const ops: Promise<void>[] = [];
					if (html.length > 0) ops.push(unshift(...html));
					if (other.length > 0) ops.push(push(...other));
					return Promise.all(ops).then(() => {});
				};

				return async () => {
					// Pause here, not inside `fetchDestination` or deeper, so a
					// paused worker shows as a long-running dealer task instead
					// of requiring any change to `@d-zero/dealer` itself — a
					// closed gate resolves the instant `#handleOutageSuspect`'s
					// recovery probe succeeds (see `network-gate.ts`).
					await this.#networkGate.wait();

					// Interval delay is handled here instead of by dealer because
					// DNS-burned hosts must skip the wait entirely. Spending the
					// per-URL interval on a host the cache already knows is dead
					// just slows the crawl down for zero benefit — the HEAD won't
					// be fired and `Crawler.#sendHeadRequest` will throw the
					// preload short-circuit immediately. For all other URLs, run
					// the same `delay()` + `%countdown(...)` log that dealer would
					// have emitted, so the dealer display reads identically.
					const burned = dnsBurnedHostCache.has(url.hostname.toLowerCase());
					if (!burned && this.#options.interval && this.#options.interval > 0) {
						await delay(this.#options.interval, (determinedInterval) => {
							update(
								`Waiting interval: %countdown(${determinedInterval},${_index}_interval)%ms`,
							);
						});
					}

					const log = createTimedUpdate(update, this.#options.verbose);

					// `#scrapePage` 内のブラウザ HTML レンダーが成功したかをマークするフラグ。
					// 成功時のみ #scrapePage 側で true に設定される。
					// discard 判定後にこのフラグを見てカウントするので、launch 失敗や predicted-discard は除外される。
					let renderedInBrowser = false;
					const markBrowserScrape = () => {
						renderedInBrowser = true;
					};

					try {
						const robotsAllowed = await this.#robotsChecker.isAllowed(url);
						if (!robotsAllowed) {
							handleIgnoreAndSkip(url, this.#linkList, this.#scope, this.#options);
							void this.emit('skip', {
								url: url.href,
								reason: 'blocked by robots.txt',
								isExternal,
							});
							log(c.gray('Blocked by robots.txt'));
							return;
						}

						const isSkip = shouldSkipUrl({
							url,
							excludes: this.#options.excludes,
							excludeUrls: this.#options.excludeUrls,
							options: this.#options,
						});

						if (isSkip) {
							handleIgnoreAndSkip(url, this.#linkList, this.#scope, this.#options);
							void this.emit('skip', { url: url.href, reason: 'excluded', isExternal });
							log(c.gray('Skipped'));
							return;
						}

						if (!this.#options.fetchExternal && isExternal) {
							const pageData = linkToPageData({
								url,
								isExternal,
								isLowerLayer: false,
							});
							this.#linkList.done(url, this.#scope, { page: pageData }, this.#options);
							void this.emit('externalPage', {
								result: pageData,
								source: derivePageSource(
									this.#options.inventoryMode,
									url.withoutHashAndAuth,
								),
							});
							log(c.dim('External (skip fetch)'));
							return;
						}

						const metadataOnly = this.#linkList.isMetadataOnly(url.withoutHash);
						const isPredicted = this.#linkList.isPredicted(url.withoutHashAndAuth);

						log('Scraping%dots%');
						const result = await this.#scrapePage(
							url,
							log,
							metadataOnly,
							_index,
							markBrowserScrape,
						);

						// Redirect convergence (#73): the destination was already
						// rendered during this crawl, so only the redirect edge is
						// recorded and the browser was never launched. Mark the URL
						// done and emit `redirect` (routed to `Archive.setRedirect`,
						// which writes the edge without touching the destination's
						// content). This URL does not count toward pagesScraped.
						if (result.type === 'redirect-edge') {
							// Note: a predicted (speculative) URL that reaches here genuinely
							// redirects (the server returned 3xx), so it is a real URL — we
							// record its edge rather than discard it. This matches the render
							// path, where the first predicted source to a destination renders
							// it and is recorded as a redirect source the same way; only 404 /
							// error predicted URLs are dropped (by `shouldDiscardPredicted`).
							//
							// The `source` discriminator divides this branch in two:
							//
							// - `'http-chain'` — the HEAD pre-flight resolved a real 3xx chain
							//   and the destination is already rendered (`#scrapedDestinations`
							//   claim). Every URL in `redirectPaths` is intermediate / known,
							//   so the existing behaviour applies: `linkList.done` folds the
							//   whole chain into the done-set so later references skip cleanly.
							//
							// - `'js-redirect'` — `scraper.scrapeStart` threw because
							//   `page.goto()` returned null (`window.location.replace()` /
							//   meta-refresh fired mid-navigation), and `redirectPaths`
							//   carries the single JS target Chromium ended up on. That target
							//   has NOT been rendered yet — it must enter the crawl queue, and
							//   `linkList.done` MUST NOT fold it into the done-set (otherwise
							//   the dealer's `seen` rejects the push and the destination is
							//   silently lost from the archive).
							if (result.source === 'js-redirect') {
								const destination = result.pageData.redirectPaths.at(-1);
								if (destination) {
									const destinationUrl = parseUrl(destination, this.#options);
									if (destinationUrl) {
										// Gate 2: this direct enqueue does not go through
										// `#handleResult`'s addUrl closure (gate 1), so it needs
										// its own same-cluster-cap check — a JS-redirect trap
										// that advances a parameter via `location.replace()`
										// would otherwise keep re-entering the queue here.
										const gateShapeKey = computeShapeKey(
											destinationUrl.withoutHashAndAuth,
										);
										const isCapped =
											this.#options.dedupeCap !== null &&
											gateShapeKey !== null &&
											findScopeEntry(destinationUrl, this.#scope, this.#options) !==
												null &&
											this.#dedupeCapTracker.isCapped(gateShapeKey);
										if (isCapped) {
											if (gateShapeKey) this.#recordDedupeCapRejection(gateShapeKey);
										} else {
											this.#linkList.add(destinationUrl);
											void enqueue(destinationUrl);
										}
									} else {
										// `deriveJsRedirectTarget` already canonicalises
										// via WHATWG URL parsing, so reaching the
										// `parseUrl === null` branch here would mean
										// `@d-zero/shared/parse-url` rejected what
										// WHATWG accepted — unexpected, and silently
										// dropping the destination would be a silent
										// archive loss. Log it so DEBUG=Nitpicker:Crawler
										// catches the case.
										crawlerLog(
											'JS-redirect destination %s failed to parse — dropping enqueue',
											destination,
										);
									}
								} else {
									crawlerLog(
										'JS-redirect result for %s had no redirectPaths destination — dropping enqueue',
										url.href,
									);
								}
								this.#linkList.done(
									url,
									this.#scope,
									{ page: result.pageData },
									this.#options,
									{ includeRedirectPaths: false },
								);
							} else {
								this.#linkList.done(
									url,
									this.#scope,
									{ page: result.pageData },
									this.#options,
								);
							}
							// The redirect-edge call path may INSERT a brand-new
							// destination row (js-redirect rescue, #73
							// convergence on first sight). Forward the
							// originating page's inventory provenance so the
							// destination + intermediate hops inherit the
							// chain's lineage instead of laundering to DB
							// DEFAULT `'crawled'`. `inventoryMode === null`
							// (resume / retry-failed) yields `undefined`,
							// which is correct: the DB-side lookup in
							// `#linkRedirectSources` reads the destination's
							// stored source for those sessions.
							void this.emit(
								'redirect',
								buildRedirectEvent(
									result.pageData,
									this.#options.inventoryMode,
									url.withoutHashAndAuth,
								),
							);
							log(c.dim('Redirect (dest already scraped)'));
							return;
						}

						// Discard predicted URLs that failed (404, error, etc.)
						if (isPredicted && shouldDiscardPredicted(result)) {
							handleIgnoreAndSkip(url, this.#linkList, this.#scope, this.#options);
							log(c.dim('Predicted (discarded)'));
							return;
						}

						// Discard a predicted URL whose rendered body is a
						// byte-for-byte duplicate of the previous predicted page of the
						// same shape, and stop generating further predictions for that
						// shape (checked above, in the pagination-pattern branch). This
						// is the always-on backstop against a site that returns 2xx for
						// any extrapolated token but ignores it entirely (e.g. always
						// serving the same "no results" template) — `shouldDiscardPredicted`
						// alone cannot see this, since it only inspects HTTP status.
						if (
							isPredicted &&
							result.type === 'success' &&
							result.pageData &&
							result.pageData.html.length > 0
						) {
							const shapeKey = computeShapeKey(url.withoutHashAndAuth);
							if (shapeKey) {
								const bodyHash = computeBodyHash(result.pageData.html);
								const lastBodyHash = this.#predictedShapeBodyHashes.get(shapeKey) ?? null;
								if (isPredictedContentDuplicate(bodyHash, lastBodyHash)) {
									this.#predictedShapeStopped.add(shapeKey);
									handleIgnoreAndSkip(url, this.#linkList, this.#scope, this.#options);
									log(c.dim('Predicted (content duplicate, discarded)'));
									return;
								}
								this.#predictedShapeBodyHashes.set(shapeKey, bodyHash);
							}
						}

						// Count only after discard check: rendered HTML pages that
						// will be persisted to the archive. Launch failures bypass
						// this point via the catch block; discarded predicted URLs
						// return above without reaching here.
						if (renderedInBrowser) {
							pagesScraped++;
						}

						log('Saving results%dots%');
						this.#handleResult(result, url, enqueue, concurrency);
						const parentSource = await this.#resolveParentSource(url);
						this.#handleResources(result.resources, parentSource);
						this.#handleConsoleLogs(
							result.consoleLogs,
							url,
							result.pageData?.redirectPaths ?? [],
						);
						log(formatResultSummary(result));

						// Phase errors must be emitted AFTER 'page' / 'externalPage'
						// so the orchestrator's WriteQueue sees `setPage` before
						// `insertPageError` and the URL→pageId resolution succeeds.
						this.#drainPhaseErrors(url, isExternal);
					} catch (error) {
						crawlerLog('Worker error for %s: %O', url.href, error);
						log(c.red('Error'));
						const workerError = error instanceof Error ? error : new Error(String(error));
						handleScrapeError(
							{
								url,
								error: workerError,
								shutdown: false,
								pid: process.pid,
							},
							this.#linkList,
							this.#scope,
							this.#options,
						);
						void this.emit('error', {
							pid: process.pid,
							isMainProcess: true,
							url: url.href,
							isExternal,
							error: workerError,
						});
						// Hard-error path: persist whatever phase errors we have
						// already buffered so they are not lost.
						this.#drainPhaseErrors(url, isExternal);
					} finally {
						if (isExternal) {
							externalDoneUrls.add(protocolAgnosticKey(url.withoutHashAndAuth));
						}
						// Phase errors still in the buffer here were not drained
						// by the success or catch paths — typically because a
						// predicted URL was discarded before reaching the drain
						// point. The helper logs the drop (observable via
						// DEBUG=Nitpicker:Crawler) and removes the entry so the
						// Map cannot leak across crawls.
						logUndrainedPhaseErrors(this.#pendingPhaseErrors, url.href, crawlerLog);
					}
				};
			},
			{
				limit: concurrency,
				// Interval is applied per-URL inside the worker callback above so
				// DNS-burned hosts can skip it. Letting dealer handle interval
				// would run the wait before our short-circuit check fires.
				interval: 0,
				verbose: this.#options.verbose || !process.stdout.isTTY,
				signal: this.#abortController.signal,
				header: (_progress, done, total, limit) => {
					return formatCrawlProgress({
						done,
						total,
						resumeOffset,
						externalTotal: externalUrls.size,
						externalDone: externalDoneUrls.size,
						pagesScraped,
						limit,
					});
				},
				onPush: (url) => {
					const key = protocolAgnosticKey(url.withoutHashAndAuth);
					if (seen.has(key)) return false;
					seen.add(key);
					if (findScopeEntry(url, this.#scope, this.#options) === null) {
						externalUrls.add(key);
					}
					return true;
				},
			},
		);

		crawlerLog('Crawl End');
		void this.emit('crawlEnd', {});
	}
	/**
	 * While {@link #networkGate} is closed, probe every
	 * `networkOutageProbeIntervalMs` until one succeeds, then reopen the
	 * gate and emit `networkOutageRecovered`.
	 *
	 * If the crawl is aborted while this loop is running, the gate is
	 * opened anyway (so any worker stuck on `#networkGate.wait()` can
	 * unblock and `deal()` can resolve) but `networkOutageRecovered` is NOT
	 * emitted — an abort says nothing about whether the network actually
	 * recovered, so the `network_outages` row is deliberately left open for
	 * the next writer session's boot-time finalizer
	 * (`close-stale-open-network-outages.ts`) to resolve. Either way,
	 * {@link #onGateReopened} still runs — the cached failures are stale
	 * regardless of why the gate reopened.
	 * @param probeHost - The hostname to probe, chosen once by
	 *   {@link #handleOutageSuspect} and reused for every attempt in this loop.
	 * @param startedAt - The outage's `startedAt`, forwarded to {@link #onGateReopened}.
	 */
	async #runRecoveryProbeLoop(probeHost: string, startedAt: number): Promise<void> {
		const probe = this.#options.networkProbe ?? probeNetwork;
		const bailIfAborted = (): boolean => {
			if (!this.#abortController.signal.aborted) {
				return false;
			}
			this.#networkGate.open();
			this.#onGateReopened(startedAt, Date.now());
			return true;
		};

		if (bailIfAborted()) {
			return;
		}
		for (;;) {
			await delay(this.#options.networkOutageProbeIntervalMs);
			if (bailIfAborted()) {
				return;
			}
			const recovered = await probe(probeHost);
			if (recovered) {
				const endedAt = Date.now();
				this.#networkGate.open();
				this.#onGateReopened(startedAt, endedAt);
				void this.emit('networkOutageRecovered', { endedAt });
				return;
			}
		}
	}
	/**
	 * Orchestrates the full scrape pipeline for a single URL.
	 *
	 * Flow:
	 * 1. Non-HTTP protocols → delegate directly to browser scraper
	 * 2. HEAD pre-flight → check availability and content type
	 * 3. Title-only mode → extract `<title>` via partial GET, skip browser
	 * 4. Non-HTML content → return HEAD result, skip browser
	 * 5. HTML content → launch browser with preflight result
	 * @param url - Target URL to scrape
	 * @param update - Callback for progress messages
	 * @param metadataOnly - When true, only extract title metadata without full browser scraping
	 * @param laneIndex - The dealer lane index, used to create unique countdown IDs
	 * @param markBrowserScrape - Called once **after** the browser successfully
	 *   renders an HTML page (i.e. `_launchBrowserAndScrape` resolved with
	 *   `type: 'success'`). Not called for HEAD-only, title-only, captured-resource
	 *   reuse, non-HTML responses, non-HTTP protocols (mailto:, tel:), browser
	 *   launch throws (e.g. invalid executablePath), or scraper-returned
	 *   `type: 'error'` results. The caller is responsible for further filtering
	 *   (e.g. predicted-discard).
	 * @returns The scrape result
	 */
	async #scrapePage(
		url: ExURL,
		update: (log: string) => void,
		metadataOnly: boolean,
		laneIndex: number,
		markBrowserScrape: () => void,
	): Promise<ScrapeOutcome> {
		const isExternal = findScopeEntry(url, this.#scope, this.#options) === null;

		// Non-HTTP protocols (mailto:, tel:, etc.) — let the scraper handle early return
		if (!url.isHTTP) {
			return this._launchBrowserAndScrape(url, update, isExternal, metadataOnly);
		}

		// Reuse captured resource data — when this URL was already observed as a
		// sub-resource during page rendering, its response data is recorded and
		// the HEAD pre-flight is redundant. Only 2xx non-HTML rows are eligible
		// (see resourceToPageData); anything else falls through to the pre-flight.
		// Both URL variants are checked because scope-auth injection adds
		// credentials to queued URLs while browser-captured resource URLs have none.
		// The result is deliberately NOT written to destinationCache: a queued URL
		// is processed at most once (the dealer dedupes by protocol-agnostic key),
		// so a URL that takes this path never reaches fetchDestination again.
		const lookupResource = this.#options.lookupResource;
		if (
			lookupResource &&
			(this.#resources.has(url.withoutHash) ||
				this.#resources.has(url.withoutHashAndAuth))
		) {
			update('Checking captured resource%dots%');
			let resource: ResourceLookupResult | null = null;
			try {
				resource = await lookupResource([url.withoutHash, url.withoutHashAndAuth]);
			} catch (error) {
				// A lookup failure must never be worse than not having the
				// optimization — fall back to the HEAD pre-flight below.
				crawlerLog('Resource lookup failed for %s, falling back: %O', url.href, error);
			}
			const pageData = resource
				? resourceToPageData({ url, isExternal, resource })
				: null;
			if (pageData) {
				crawlerLog('Reused captured resource for %s', url.href);
				return {
					type: 'success',
					pageData: metadataOnly ? { ...pageData, isTarget: false } : pageData,
					resources: [],
					consoleLogs: [],
				};
			}
		}

		// Pre-flight: lightweight HEAD request to check server availability
		update('HEAD request%dots%');
		let headCheckResult: PageData;
		try {
			headCheckResult = await this.#sendHeadRequest(url, isExternal, update, laneIndex);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			// Puppeteer-only fallback: when the HEAD pre-flight (and its GET
			// companion inside `fetchDestination`) exhaust retries on what
			// looks like an HTML URL, give the browser exactly one chance
			// before recording the page as `status = -1`. Some middleboxes /
			// WAF configurations drop bare HEAD/GET probes (parse-error,
			// reset, silent timeout) while still answering a real puppeteer
			// navigation; those URLs would otherwise be permanently lost.
			//
			// Restricted to non-metadataOnly scrapes because metadata-only
			// mode is a bandwidth-saving path for external pages — there is
			// no payoff in spinning up puppeteer when the row was never
			// going to be fully rendered. `isPuppeteerFallbackCandidate`
			// filters PreloadShortCircuitError automatically via its
			// classifier check (its synthesised message classifies as `dns`).
			if (
				!metadataOnly &&
				isLikelyHtmlUrl(url) &&
				isPuppeteerFallbackCandidate(errorMessage)
			) {
				update(c.yellow('HEAD/GET unreachable — trying puppeteer once'));
				try {
					const fallback = await this._launchBrowserAndScrape(
						url,
						update,
						isExternal,
						metadataOnly,
					);
					if (fallback.type === 'success') {
						if (fallback.pageData) {
							const renderedKey = redirectDestKey(url, fallback.pageData.redirectPaths);
							this.#scrapedDestinations.add(renderedKey);
						}
						// Puppeteer fallback proved the host is reachable
						// (HEAD/GET probes died at a middlebox / WAF but the
						// real browser navigation got a response). Mark the
						// host alive for the cascade guard — without this, a
						// host whose first URL only succeeded via the
						// browser-rescue path would still be vulnerable to
						// the next URL's HEAD failure burning it.
						this.#successfulHosts.add(url.hostname.toLowerCase());
						markBrowserScrape();
						return fallback;
					}
					if (fallback.type === 'skipped') {
						// Puppeteer rendered the page far enough for the scraper
						// to match an `excludeKeywords` rule. That is a definitive
						// "skip" verdict from the browser, NOT an unreachable
						// host — surface the skip so downstream handling (skip
						// counter, anchor-extraction suppression, `setSkippedPage`
						// in the archive) behaves identically to the case where
						// HEAD had succeeded. Without this branch, the page would
						// be recorded as `status = -1` with the HEAD timeout
						// message — a misleading entry that conflates
						// "operator-intended skip" with "network failure".
						//
						// Skipped also counts as proof-of-life: the browser
						// reached the page far enough to match exclude rules,
						// so the host was clearly responding.
						this.#successfulHosts.add(url.hostname.toLowerCase());
						return fallback;
					}
					// `fallback.type === 'error'`. `_launchBrowserAndScrape`
					// catches its own exceptions and returns
					// `{type:'error', shutdown:...}` rather than throwing, so
					// the `catch` arm below would NOT see this branch. Log
					// the puppeteer-side cause (and any `shutdown` flag the
					// scraper attached) so operators have a breadcrumb that
					// the safety net actually fired and lost — otherwise
					// only the HEAD error reaches `crawl_errors` and the
					// browser failure mode is invisible.
					crawlerLog(
						'Puppeteer fallback returned error for %s: %s (shutdown=%s)',
						url.href,
						fallback.error?.message ?? '(no message)',
						fallback.error?.shutdown ?? false,
					);
					// JS-redirect rescue on the puppeteer-fallback branch:
					// the HEAD/GET probes died (the kind set in
					// `isPuppeteerFallbackCandidate` — middlebox / WAF
					// shapes), the one-shot puppeteer attempt also threw,
					// but `page.url()` reported a different post-navigation
					// URL. This is the same WAF-+-JS-redirect shape the
					// HEAD-success rescue handles one branch below, applied
					// to the prior failure layer. Without this, a URL whose
					// only sin is "HEAD blocked + JS-redirected body" falls
					// to `status = -1` and joins the retry-forever loop the
					// rescue is supposed to break. The trigger is the same
					// narrow `Page.goto returned null` shape — anything
					// else (TLS failure inside puppeteer, target crash, …)
					// must fall through to the unreachable path so the real
					// failure surfaces. We synthesise the redirect-edge
					// PageData from the HEAD error (status = -1) instead of
					// from a HEAD success, so `#linkRedirectSources` still
					// stamps the source as 301 and the edge wires the dest
					// in.
					const fallbackRescue = buildJsRedirectEdge({
						url,
						isExternal,
						errorMessage: fallback.error?.message,
						postNavigationUrl: fallback.postNavigationUrl,
						// No `headCheckResult`: HEAD itself died on this
						// path, so the synthesised PageData starts from a
						// `linkToPageData` placeholder with `status = -1`
						// carrying the original HEAD error message.
						// `#linkRedirectSources` still flips the source row
						// to 301 because NULL/-1 satisfies its conditional
						// stamp predicate.
					});
					if (fallbackRescue !== null) {
						return fallbackRescue;
					}
				} catch (browserError) {
					// Browser launch / runtime crash — fall through to the
					// unreachable path below. The original HEAD error is more
					// informative about WHY the URL wasn't reachable, so it
					// (not the puppeteer noise) is what we surface in
					// `crawl_errors`. The lane display flag below (
					// "Unreachable (fallback failed)") preserves the fact
					// that puppeteer also tried, so operators reading the
					// progress log can tell this URL got the safety-net
					// attempt versus the cheap-probe-only path.
					crawlerLog('Puppeteer fallback also failed for %s: %O', url.href, browserError);
				}
				update(c.red('Unreachable (fallback failed)'));
				return {
					type: 'error',
					resources: [],
					consoleLogs: [],
					error: {
						name: error instanceof Error ? error.name : 'Error',
						message: errorMessage,
						stack: error instanceof Error ? error.stack : undefined,
						shutdown: false,
					},
				};
			}
			// Server unreachable — skip browser launch entirely
			update(c.red('Unreachable'));
			return {
				type: 'error',
				resources: [],
				consoleLogs: [],
				error: {
					name: error instanceof Error ? error.name : 'Error',
					message: errorMessage,
					stack: error instanceof Error ? error.stack : undefined,
					shutdown: false,
				},
			};
		}

		// Redirect convergence (#73): `finalKey` is the destination this URL lands
		// on after following its redirect chain (or the URL itself when it does not
		// redirect). When that destination has already been rendered and stored
		// during this crawl, do NOT process this URL further — record the redirect
		// edge only and skip everything below, regardless of content type. This is
		// the root fix for the many-to-one redirect duplication (#70): every source
		// URL that 301s to one destination otherwise re-renders/re-stores it. The
		// check sits ABOVE the metadata-only and non-HTML branches on purpose — both
		// route their HEAD/title result through `updatePage`, which would funnel a
		// content-less result into `#insertPage` and overwrite the already-rendered
		// destination's title / meta / isExternal. The edge-only path leaves the
		// destination row intact.
		//
		// `finalKey` is also claimed for destinations reached directly (no redirect;
		// see the claim after a successful render below), so a destination that is
		// both linked directly and arrived at via a redirect is rendered by whichever
		// path wins the race, not both.
		const finalKey = redirectDestKey(url, headCheckResult.redirectPaths);
		if (this.#scrapedDestinations.has(finalKey)) {
			crawlerLog('Redirect dest already rendered, edge only: %s', url.href);
			return { type: 'redirect-edge', source: 'http-chain', pageData: headCheckResult };
		}

		// Title-only mode — extract <title> via partial GET for HTML, skip browser
		if (metadataOnly) {
			if (
				headCheckResult.contentType === null ||
				isHtmlContentType(headCheckResult.contentType)
			) {
				update('Fetching title%dots%');
				try {
					const titleResult = await fetchDestination({
						url,
						isExternal,
						method: 'GET',
						options: { titleBytesLimit: 16_384 },
						userAgent: this.#options.userAgent,
					});
					return {
						type: 'success',
						pageData: { ...titleResult, isTarget: false },
						resources: [],
						consoleLogs: [],
					};
				} catch (error) {
					crawlerLog('Title GET failed for %s: %O', url.href, error);
				}
			}
			return {
				type: 'success',
				pageData: { ...headCheckResult, isTarget: false },
				resources: [],
				consoleLogs: [],
			};
		}

		// Non-HTML content — skip browser
		if (
			headCheckResult.contentType !== null &&
			!isHtmlContentType(headCheckResult.contentType)
		) {
			return {
				type: 'success',
				pageData: headCheckResult,
				resources: [],
				consoleLogs: [],
			};
		}

		// HTML or unknown content type — launch browser with preflight result.
		// markBrowserScrape() fires only when the result is `success`.
		// `_launchBrowserAndScrape` catches internal errors and returns
		// `{ type: 'error', ... }` instead of throwing (see its catch block),
		// so awaiting alone does NOT prove the page was rendered. The explicit
		// success check excludes navigation failures, scraper exceptions, and
		// shutdown-class errors from the pages-rendered count.
		const browserResult = await this._launchBrowserAndScrape(
			url,
			update,
			isExternal,
			metadataOnly,
			headCheckResult,
		);
		if (browserResult.type === 'success') {
			markBrowserScrape();
			// Claim the destination that was ACTUALLY rendered, keyed off the
			// browser's own redirect resolution rather than the HEAD pre-flight's
			// guess (`finalKey`). The browser is authoritative for what got stored;
			// if HEAD and the browser disagree on the final URL (method-conditional
			// / JS / meta-refresh redirects), keying the claim off the HEAD guess
			// would route a sibling source to an edge pointing at a never-rendered
			// phantom row. By claiming the rendered URL, a divergent sibling simply
			// re-renders (dedup misses) instead — correct, just less optimal. In the
			// common case HEAD and the browser agree, so the keys are identical.
			//
			// Claimed only after a successful render, so a failed render leaves the
			// destination unclaimed and a later source retries it. Concurrent
			// in-flight sources to the same destination (bounded by the concurrency
			// limit) may still each render before any claim lands; the storage-layer
			// replace in `updatePage` (#70) keeps the resulting anchors / images
			// correct (sub-resources may briefly duplicate, far below the pre-#73
			// once-per-source blow-up).
			const renderedKey = browserResult.pageData
				? redirectDestKey(url, browserResult.pageData.redirectPaths)
				: finalKey;
			this.#scrapedDestinations.add(renderedKey);
			return browserResult;
		}

		// Browser scrape failed but the HEAD pre-flight already resolved a
		// redirect chain — fall back to the redirect-edge path so the chain
		// is not lost. Without this, a URL whose final destination is on
		// HTTPS→HTTP downgrade (or any other navigation Chromium refuses
		// to complete while the underlying redirect was a normal 301/302)
		// would be persisted as `status = -1` with NULL `redirectDestId`,
		// then re-picked up by every `--retry-failed` pass forever — the
		// HEAD answer is the authoritative truth and the browser cannot
		// invalidate it.
		//
		// Restricted to `type === 'error'` because:
		// - `'skipped'` is an `excludeKeywords` verdict from the browser
		//   on the rendered URL and is its own definitive outcome —
		//   surfacing it as a redirect-edge would lose the skip signal.
		// - `'success'` is handled above.
		//
		// The destination is claimed even though no row was rendered for
		// it: subsequent siblings on the same chain should also fold into
		// the same edge instead of re-firing the same failing browser
		// attempt. If the destination URL itself reaches the queue later,
		// it goes through the normal `#scrapePage` path (the claim only
		// short-circuits sibling redirect SOURCES, not the destination
		// itself).
		if (browserResult.type === 'error' && headCheckResult.redirectPaths.length > 0) {
			this.#scrapedDestinations.add(finalKey);
			crawlerLog(
				'Browser scrape failed for %s but HEAD resolved a redirect chain — recording as edge',
				url.href,
			);
			return { type: 'redirect-edge', source: 'http-chain', pageData: headCheckResult };
		}

		// JS-redirect rescue: HEAD returned a definitive response (no chain),
		// the browser scrape threw with the specific `Page.goto returned null`
		// shape (gated by `isJsRedirectErrorShape` below), and puppeteer
		// reports a different post-navigation URL via `page.url()`. The
		// motivating case is a server returning `200 OK` whose body contains
		// `window.location.replace(...)` or `<meta http-equiv="refresh">` —
		// `page.goto()` resolves to `null` once the JS-driven navigation
		// supersedes the original, and the scraper throws
		// `The method Page.goto returned null`. Recording the edge preserves
		// the link from the source to the JS-redirect target, removes the
		// page from `--retry-failed`'s candidate pool (the SQL filter
		// excludes rows with a non-null `redirectDestId`), and matches what
		// a real browser shows the user.
		//
		// What the source row reads as:
		// - the source is not committed via `setPage`/`updatePage` on this
		//   path (the redirect-edge handler in `#runDeal` only calls
		//   `linkList.done` + `emit('redirect', ...)` → `Archive.setRedirect`),
		//   so `recordRedirect` → `resolveContentItemId` creates a NULL-status
		//   placeholder row for the source if it did not already exist;
		// - `#linkRedirectSources` then stamps `status = 301
		//   statusText='Moved Permanently'` because NULL satisfies its
		//   conditional-update predicate.
		// That is the same shape an HTTP 301 source ends up with — the
		// truthful HTTP layer (the upstream's 200) is lost on this path, but
		// the alternative (status=-1 retry-forever) is strictly worse. A
		// future refinement could keep the HEAD-derived status by routing
		// the source through `setPage` before `setRedirect`; intentionally
		// deferred to keep this rescue minimal.
		//
		// Pre-claiming the destination in `#scrapedDestinations` would
		// short-circuit the freshly-enqueued destination at the top of
		// `#scrapePage` (the `if (#scrapedDestinations.has(finalKey))` guard
		// at line 1213), leaving the dest row as a content-less HEAD edge
		// instead of a fully rendered page. So we *do not* claim here — the
		// destination renders normally via the queue, and `#scrapedDestinations`
		// is populated at line ~1322 of the render-success path the way every
		// other URL is. Sibling JS-redirect sources to the same destination
		// still converge: the second sibling enters this branch, observes its
		// own `page.url()` landing on the same target, records its own
		// redirect-edge, and re-enqueues — the dealer's `seen` dedup absorbs
		// the duplicate push, so the destination renders exactly once.
		if (browserResult.type === 'error') {
			const headSuccessRescue = buildJsRedirectEdge({
				url,
				isExternal,
				errorMessage: browserResult.error?.message,
				postNavigationUrl: browserResult.postNavigationUrl,
				// `headCheckResult` is supplied here so the synthesised
				// PageData carries the real HTTP-level status / content
				// type from the HEAD pre-flight. `#linkRedirectSources`
				// only stamps 301 onto NULL/-1 status rows, so the
				// HEAD-derived status DOES survive on this path — the
				// truthful HTTP 200 is preserved.
				headCheckResult,
			});
			if (headSuccessRescue !== null) {
				return headSuccessRescue;
			}
		}
		return browserResult;
	}
	/**
	 * Performs a pre-flight HTTP HEAD request with retry logic.
	 *
	 * WHY pre-flight: Avoids launching a browser for URLs that are unreachable,
	 * non-HTML, or return error status codes. This saves significant time and
	 * resources compared to launching Puppeteer for every URL.
	 * @param url - Target URL to check
	 * @param isExternal - Whether the URL is external to the crawl scope
	 * @param update - Callback for progress messages shown in the dealer display
	 * @param laneIndex - The dealer lane index, used to create unique countdown IDs
	 * @returns Lightweight page data from the HEAD response
	 */
	async #sendHeadRequest(
		url: ExURL,
		isExternal: boolean,
		update: (msg: string) => void,
		laneIndex: number,
	): Promise<PageData> {
		const host = url.hostname.toLowerCase();
		if (dnsBurnedHostCache.has(host)) {
			// Either session-learned earlier in this crawl (one URL on this host
			// already exhausted retries with a DNS error) or preload-seeded from
			// `crawl_errors` on archive open. Either way: skip the HEAD entirely.
			// The orchestrator's error-channel listener detects
			// PreloadShortCircuitError via instanceof and refuses to write it to
			// `crawl_errors`, preventing self-amplification across crawls.
			dnsBurnedHostShortCircuitCounter.count++;
			update(c.red(`HEAD request: host ${host} DNS-burned — skipping`));
			throw new PreloadShortCircuitError(host);
		}
		// Escalating per-attempt timeout: a slow-but-reachable server (e.g. some
		// government sites under load) often answers in 20-40 s but is missed by
		// a flat 10 s race on every retry. Start short to keep crawl throughput
		// up on healthy URLs, then back off so the last attempt is generous
		// enough that "really slow" gets a fair shot before we give up.
		let attempt = 0;
		return retryCall(
			async () => {
				// Clamp the attempt index to the last entry of the escalation array
				// so retry counts past the array length keep using the longest
				// budget instead of falling off into `undefined`. `as number`
				// only because TS can't see that a positive-length readonly array
				// always has a defined last element.
				const escalationIndex = Math.min(attempt, HEAD_TIMEOUT_ESCALATION_MS.length - 1);
				const timeoutMs = HEAD_TIMEOUT_ESCALATION_MS[escalationIndex] as number;
				attempt += 1;
				const headResult = await fetchDestination({
					url,
					isExternal,
					userAgent: this.#options.userAgent,
					timeout: timeoutMs,
				});
				// Mark host alive the MOMENT an HTTP response is observed,
				// before retryCall's outer resolution settles. A later attempt
				// (or a sibling worker's onGiveUp) racing this success would
				// otherwise see an empty `#successfulHosts` and burn the host
				// — exactly the cascade the guard is here to prevent. Any HTTP
				// status counts: the guard cares about DNS-and-TCP reachability,
				// not application-level success, and `fetchDestination` only
				// resolves when an HTTP response was actually received.
				this.#successfulHosts.add(host);
				return headResult;
			},
			{
				retries: this.#options.retry,
				label: 'HEAD request',
				onWait: (determinedInterval, retryCount, label, error) => {
					this.#recordNetworkError(error.message, host);
					update(
						`${label}: ${error.message} — %countdown(${determinedInterval},fetchHead_${laneIndex}_${retryCount},s)%s (retry #${retryCount + 1})`,
					);
				},
				onGiveUp: (retryCount, error, label) => {
					this.#recordNetworkError(error.message, host);
					// Burn the host so subsequent URLs short-circuit — but ONLY
					// when this is the first time we've ever seen the host fail
					// in this session. A host that responded earlier is treated
					// as transiently unreachable (operator's resolver flipped
					// mid-crawl etc.), not a dead domain. `shouldBurnHost`
					// encapsulates this decision so the cascade guard is
					// independently testable. Also gated to `onGiveUp` rather
					// than `onWait` so an `EAI_AGAIN` that recovers on retry
					// doesn't trip the guard prematurely.
					if (
						shouldBurnHost({
							errorKind: classifyErrorKind(error.message),
							host,
							successfulHosts: this.#successfulHosts,
						})
					) {
						dnsBurnedHostCache.set(host, 'dns');
						// Recorded so a later outage recovery can tell THIS
						// burn (possibly outage-caused) apart from a
						// preload-seeded one (a cross-session, confirmed-dead
						// verdict that must never be undone by an in-session
						// recovery) — see `evict-outage-tainted-dns-burns.ts`.
						dnsBurnedHostBurnTimestamps.set(host, Date.now());
					}
					update(
						c.red(`${label}: gave up after ${retryCount} retries — ${error.message}`),
					);
				},
			},
		);
	}

	/**
	 * Launches a fresh Puppeteer browser, runs the beholder scraper, and cleans up.
	 *
	 * WHY per-URL browser: Each URL gets its own browser instance to ensure
	 * complete isolation (cookies, cache, service workers). The browser is always
	 * closed in the `finally` block, even on error.
	 *
	 * The cascade-guard contract for the puppeteer-fallback success / skipped
	 * branches can be exercised via `vi.spyOn(Crawler.prototype,
	 * '_launchBrowserAndScrape')` in unit tests. There is no production
	 * consumer outside this class.
	 * @internal
	 * @param url - Target URL to scrape
	 * @param update - Callback for progress messages
	 * @param isExternal - Whether the URL is external to the crawl scope
	 * @param metadataOnly - When true, only extract title metadata
	 * @param headCheckResult - Optional HEAD result to pass to the scraper, avoiding a redundant request
	 * @returns The scrape result from beholder
	 */
	// eslint-disable-next-line no-restricted-syntax -- intentional `private` (vs `#`) so tests can spyOn the prototype to drive the puppeteer-fallback cascade-guard branches without a full browser mock; see JSDoc above.
	private async _launchBrowserAndScrape(
		url: ExURL,
		update: (log: string) => void,
		isExternal: boolean,
		metadataOnly: boolean,
		headCheckResult?: PageData,
	): Promise<BrowserScrapeResult> {
		update('Launching browser%dots%');
		if (this.#options.executablePath) {
			const execPath = path.resolve(this.#options.executablePath);
			if (!existsSync(execPath)) {
				throw new Error(`Executable path does not exist: ${execPath}`);
			}
		}
		const puppeteer = await import('puppeteer');
		const browser = await puppeteer.launch({
			headless: true,
			...(this.#options.executablePath
				? { executablePath: this.#options.executablePath }
				: {}),
		});

		// `page` is hoisted out of the try-block so the catch arm can read
		// `page.url()` for JS-redirect detection. See `BrowserScrapeResult`
		// JSDoc for the full why; in short, when `scrapeStart` throws because
		// `page.goto()` returned `null`, the puppeteer page object still
		// holds the URL Chromium actually navigated to via the offending
		// `window.location.replace()` / meta-refresh, and that is the only
		// authoritative source for the JS-redirect destination.
		let page: PuppeteerPage | null = null;
		try {
			update('Creating page%dots%');
			page = await browser.newPage();
			await page.setUserAgent(this.#options.userAgent);
			// HTTP-auth handling — two cooperating pieces, BOTH required:
			//
			// 1. `page.authenticate({user, pass})` (always, even with empty
			//    strings) registers a Fetch-domain auth handler with
			//    Chromium. With empty credentials it ALSO drains Chromium's
			//    native HTTP-auth dialog without sending anything
			//    privileged — the dialog cannot be captured by
			//    `page.on('dialog')` (HTTP-auth is not a JS dialog) and
			//    would otherwise hang the navigation until puppeteer's
			//    timeout fires. With non-empty credentials it provides the
			//    scope's auth so the in-scope navigation succeeds.
			//
			// 2. Stripping URL-embedded credentials from the navigation
			//    target. **This is the credential-leak guard.** When the
			//    URL we hand puppeteer carries `user:pass@host`, Chromium
			//    promotes those credentials into its HTTP-auth cache
			//    keyed by (scheme, host, port, realm). Subsequent
			//    sub-resource requests issued from the same page —
			//    including cross-origin requests to a different hostname
			//    sharing the same IP / port (e.g. an embedded
			//    `<img src="http://127.0.0.1:PORT/…">` loaded from a
			//    `localhost:PORT` page) — get the cached `Authorization`
			//    header re-attached by the network stack. The
			//    `Fetch.authRequired` event never fires for these
			//    pre-emptive attachments, so neither `page.authenticate`
			//    nor any custom Fetch listener can filter them. The only
			//    way to keep the cred out of the cross-origin request is
			//    to make sure it never enters the cache in the first
			//    place — hence stripping the URL before navigation.
			//
			// Verified by `scope-auth-leak.e2e.ts`: removing either piece
			// causes that test to fail (without auth → main 401 hangs;
			// without strip → scope cred leaks to off-scope sub-resource).
			await page.authenticate({
				username: url.username ?? '',
				password: url.password ?? '',
			});
			// Re-parse from `withoutHashAndAuth` rather than mutating the
			// re-parsed `url.href` object: ExURL pre-computes `href`,
			// `withoutHash` and other derived strings at parse time, and
			// post-hoc field assignment (`navigateUrl.username = ''`)
			// leaves those derived strings stale. Anything downstream that
			// reads `navigateUrl.href` (e.g. a future beholder bump that
			// switches `page.goto` from `withoutHashAndAuth` to `href`)
			// would silently get back the credentialed string — defeating
			// the leak guard. Building the navigation URL from a known
			// credential-free string guarantees every field is consistent.
			const navigateUrl = parseUrl(url.withoutHashAndAuth) ?? url;
			const scraper = new Scraper();

			scraper.on(
				'changePhase',
				createChangePhaseHandler({
					emit: (event) => void this.emit('changePhase', event),
					update,
					formatLog: formatPhaseLog,
					buffer: this.#pendingPhaseErrors,
					urlHref: url.href,
				}),
			);

			const result = await scraper.scrapeStart(page, navigateUrl, {
				isExternal,
				captureImages: !isExternal && this.#options.captureImages,
				excludeKeywords: this.#options.excludeKeywords,
				disableQueries: this.#options.disableQueries,
				metadataOnly,
				retries: this.#options.retry,
				headCheckResult,
				mainContentSelector: this.#options.mainContentSelector,
			});

			// Image dom-path capture runs here — after the scrape completed but
			// while `page` is still alive — because beholder's image metadata
			// carries each element's `outerHTML` with no positional
			// information. The captured candidates ride on the page data into
			// `image_items.dom_path_text_id` resolution at write time; a
			// capture failure (or a page with no images) falls back to the
			// synthetic `unknown/<n>` markers, so this stays best-effort.
			if (
				result.type === 'success' &&
				result.pageData &&
				result.pageData.imageList.length > 0
			) {
				const imageDomPaths = await captureImageDomPaths(page);
				if (imageDomPaths !== undefined) {
					const withDomPaths: PageDataWithDomPaths = {
						...result.pageData,
						imageDomPaths,
					};
					result.pageData = withDomPaths;
				}
			}

			update('Closing browser%dots%');
			// JS-redirect rescue capture: when `scrapeStart` catches a
			// `#fetchData` throw internally (e.g. `Page.goto returned null`
			// because a client-side `window.location.replace()` /
			// meta-refresh fired), it returns `{ type: 'error', ... }`
			// instead of re-throwing — so the `catch` arm below never
			// sees those cases. Read `page.url()` here while `page` is
			// still alive (finally still hasn't called `handleBrowserClose`)
			// and attach it to the result so `#scrapePage` can fold the
			// source into a redirect edge. Without this capture, the
			// rescue path is dead for the most common failure shape it
			// was designed to handle.
			//
			// `page.url()` itself can throw when the browser context died
			// mid-scrape (target crashed, session killed). On failure we
			// fall through with `postNavigationUrl` unset so the existing
			// HEAD-chain rescue / normal error path takes over.
			if (result.type === 'error') {
				try {
					const postNavigationUrl = page.url();
					return { ...result, postNavigationUrl };
				} catch (urlReadError) {
					crawlerLog(
						'Reading page.url() for JS-redirect detection failed on %s: %O',
						url.href,
						urlReadError,
					);
				}
			}
			return result;
		} catch (error) {
			// JS-redirect rescue: when `scrapeStart` throws because
			// `page.goto()` returned `null` (the symptom of a client-side
			// `window.location.replace()` / meta-refresh navigating away
			// before the original response materialised), `page.url()` still
			// reports the destination Chromium ended up on. Capturing it
			// here lets `#scrapePage` fold the source into a redirect edge
			// instead of recording a hard `status = -1` — `Page.goto returned
			// null` classifies as `protocol`, which is neither permanent nor
			// a puppeteer-fallback kind, so without this rescue the page
			// loops through `--retry-failed` forever with the same failure.
			//
			// `page.url()` itself can throw when the browser context is
			// already torn down (target closed, session killed). Treat any
			// such failure as "no extra information" and fall back to the
			// normal error path — the existing redirect-edge fallback that
			// keys off `headCheckResult.redirectPaths` may still rescue the
			// page when the HEAD pre-flight resolved a chain.
			let postNavigationUrl: string | undefined;
			if (page) {
				try {
					postNavigationUrl = page.url();
				} catch (urlReadError) {
					crawlerLog(
						'Reading page.url() for JS-redirect detection failed on %s: %O',
						url.href,
						urlReadError,
					);
				}
			}
			return {
				type: 'error',
				resources: [],
				consoleLogs: [],
				error: {
					name: error instanceof Error ? error.name : 'Error',
					message: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					shutdown: true,
				},
				...(postNavigationUrl === undefined ? {} : { postNavigationUrl }),
			};
		} finally {
			// handleBrowserClose force-kills the underlying Chromium when a
			// graceful close() hangs (e.g. the session died mid-scrape) and
			// guarantees the finally never throws, so the try-block's return
			// value or caught error is never masked.
			await handleBrowserClose(browser, url.href, crawlerLog);
		}
	}

	/**
	 * The default maximum number of concurrent scraping processes.
	 *
	 * Used when `parallels` is not specified or is set to 0.
	 */
	static readonly MAX_PROCESS_LENGTH = 10;
}

/**
 * Colorize an HTTP status code string for terminal display.
 *
 * - 2xx: green
 * - 3xx: yellow
 * - 4xx/5xx: red
 * - Unknown: no color
 * @param status - The HTTP status code, or `undefined` if unknown.
 * @returns A colorized "Done (status)" string.
 */
function colorStatus(status: number | undefined) {
	const text = `Done (${status ?? '?'})`;
	if (!status) return text;
	if (status < 300) return c.green(text);
	if (status < 400) return c.yellow(text);
	return c.red(text);
}

/**
 * Maps a beholder phase event to a human-readable log message for the dealer display.
 * Returns `null` for phases that should not produce visible output (e.g. scrapeStart/End).
 * @param e - The phase change event from beholder
 * @returns A formatted message string, or `null` to suppress output
 */
function formatPhaseLog(e: ChangePhaseEvent): string | null {
	switch (e.name) {
		case 'scrapeStart':
		case 'scrapeEnd': {
			return null;
		}
		case 'headRequest': {
			return 'HEAD request%dots%';
		}
		case 'openPage': {
			return `Opening page%dots% ${e.message}`;
		}
		case 'loadDOMContent': {
			return c.dim('DOM loaded');
		}
		case 'getHTML': {
			return 'Getting HTML%dots%';
		}
		case 'waitNetworkIdle': {
			return 'Waiting for network idle%dots%';
		}
		case 'getAnchors': {
			return 'Extracting anchors%dots%';
		}
		case 'getMeta': {
			return 'Extracting meta%dots%';
		}
		case 'extractImages': {
			return 'Fetching images%dots%';
		}
		case 'setViewport':
		case 'scrollToBottom':
		case 'waitImageLoad':
		case 'retryWait': {
			return e.message;
		}
		case 'retryExhausted': {
			return c.red(e.message);
		}
		case 'getImages': {
			return e.message;
		}
		case 'pageSkipped': {
			return c.yellow(`Skipped: ${e.message}`);
		}
		default: {
			return e.name;
		}
	}
}

/**
 * Wraps an update callback to append elapsed time between calls (e.g. `+42ms`).
 * Only active when verbose mode is enabled; otherwise returns the original callback.
 * @param update - The original dealer update callback
 * @param verbose - Whether verbose mode is enabled
 * @returns A wrapped update callback that appends timing information
 */
function createTimedUpdate(
	update: (msg: string) => void,
	verbose?: boolean,
): (msg: string) => void {
	if (!verbose) return update;
	let prev = Date.now();
	return (msg: string) => {
		const now = Date.now();
		const delta = now - prev;
		prev = now;
		update(`${msg} ${c.dim(`+${delta}ms`)}`);
	};
}

/**
 * Formats a one-line summary of a scrape result for the dealer display.
 * Shows HTTP status (colorized), anchor/image/resource counts for target pages.
 * @param result - The scrape result to summarize
 * @returns A colorized summary string
 */
function formatResultSummary(result: ScrapeResult): string {
	switch (result.type) {
		case 'success': {
			const status = colorStatus(result.pageData?.status);
			if (result.pageData?.isTarget) {
				const anchors = result.pageData.anchorList.length;
				const images = result.pageData.imageList.length;
				const resources = result.resources.length;
				return `${status} ${c.cyan(`\u{1F517} ${anchors}`)} ${c.magenta(`\u{1F5BC}\u{FE0F} ${images}`)} ${c.dim(`\u{1F4E6} ${resources}`)}`;
			}
			return status;
		}
		case 'skipped': {
			return c.gray('Skipped');
		}
		case 'error': {
			return c.red('Error');
		}
		default: {
			return result.type;
		}
	}
}
