import type { CrawlerEventTypes, CrawlerOptions, ResourceLookupResult } from './types.js';
import type {
	ChangePhaseEvent,
	PageData,
	ResourceEntry,
	ScrapeResult,
} from '@d-zero/beholder';
import type { ExURL } from '@d-zero/shared/parse-url';

import { existsSync } from 'node:fs';
import path from 'node:path';

import Scraper from '@d-zero/beholder';
import { deal } from '@d-zero/dealer';
import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { retryCall } from '@d-zero/shared/retry';
import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';
import c from 'ansi-colors';

import pkg from '../../package.json' with { type: 'json' };
import { crawlerLog } from '../debug.js';

import { createChangePhaseHandler } from './create-change-phase-handler.js';
import { detectPaginationPattern } from './detect-pagination-pattern.js';
import { drainPhaseErrors } from './drain-phase-errors.js';
import { fetchDestination } from './fetch-destination.js';
import { findScopeEntry } from './find-scope-entry.js';
import { formatCrawlProgress } from './format-crawl-progress.js';
import { generatePredictedUrls } from './generate-predicted-urls.js';
import { handleBrowserClose } from './handle-browser-close.js';
import { handleIgnoreAndSkip } from './handle-ignore-and-skip.js';
import { handleResourceResponse } from './handle-resource-response.js';
import { handleScrapeEnd } from './handle-scrape-end.js';
import { handleScrapeError } from './handle-scrape-error.js';
import { injectScopeAuth } from './inject-scope-auth.js';
import { isHtmlContentType } from './is-html-content-type.js';
import LinkList from './link-list.js';
import { linkToPageData } from './link-to-page-data.js';
import { logUndrainedPhaseErrors } from './log-undrained-phase-errors.js';
import { partitionUrlsByHtml } from './partition-urls-by-html.js';
import { protocolAgnosticKey } from './protocol-agnostic-key.js';
import { resourceToPageData } from './resource-to-page-data.js';
import { RobotsChecker } from './robots-checker.js';
import { shouldDiscardPredicted } from './should-discard-predicted.js';
import { shouldSkipUrl } from './should-skip-url.js';

export type { CrawlerOptions } from './types.js';

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
	/** Tracks discovered URLs, their scrape status, and deduplication. */
	readonly #linkList = new LinkList();
	/** Merged crawler configuration (user overrides + defaults). */
	readonly #options: CrawlerOptions;
	/**
	 * Phase errors observed during {@link Crawler.#launchBrowserAndScrape},
	 * buffered per URL href so they can be emitted as `pageError` events
	 * AFTER the corresponding `page` / `externalPage` event. This ordering
	 * lets the orchestrator's WriteQueue serialise `setPage` before
	 * `insertPageError`, so the FK resolution via URL always finds the row.
	 */
	readonly #pendingPhaseErrors = new Map<
		string /* url.href */,
		{ phase: string; message: string }[]
	>();
	/** Set of resource URLs (without hash) already captured, for deduplication. */
	readonly #resources = new Set<string>();
	/** URLs restored from a previous session that still need to be scraped. */
	#resumedPending: ExURL[] = [];
	/** URLs already scraped in a previous session, used to populate the `seen` set in {@link #runDeal}. */
	#resumedScraped: string[] = [];
	/** Checker for robots.txt compliance. */
	readonly #robotsChecker: RobotsChecker;

	/** Maps hostnames to their scope URLs. Defines the crawl boundary for internal/external classification. */
	readonly #scope = new Map<string /* hostname */, ExURL[]>();

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
			lookupResource: options?.lookupResource ?? null,
		};

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
	 */
	resume(pending: string[], scraped: string[], resources: string[]) {
		this.#resumedPending = this.#linkList.resume(pending, scraped, this.#options);
		this.#resumedScraped = scraped;
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
	 * @param urls - The list of root URLs to begin crawling from. Must be non-empty.
	 * @param opts - Optional overrides; currently only `recursive` is honoured.
	 * @param opts.recursive - When `false`, disables recursive discovery and forces list-mode.
	 *   Defaults to the constructor option's `recursive` value.
	 * @throws {Error} If the URL list is empty.
	 */
	start(urls: ExURL[], opts?: { recursive?: boolean }) {
		const root = urls[0];
		if (!root) {
			throw new Error('urls is empty');
		}

		for (const url of urls) {
			const existing = this.#scope.get(url.hostname) || [];
			if (!existing.some((u) => u.href === url.href)) {
				this.#scope.set(url.hostname, [...existing, url]);
			}
			this.#linkList.add(url);
		}

		const recursive = opts?.recursive ?? this.#options.recursive;
		if (!recursive) {
			this.#options.recursive = false;
			this.#options.fromList = true;
		}

		const isResuming = this.#resumedScraped.length > 0;
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
		const resumeOffset = this.#resumedScraped.length;

		if (initialUrls.length === 0) {
			crawlerLog('Crawl End (nothing to resume)');
			void this.emit('crawlEnd', {});
			return;
		}

		void this.#runDeal(initialUrls, resumeOffset).catch((error) => {
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
	 * Processes captured sub-resources from a page scrape, deduplicates them,
	 * and emits `response` / `responseReferrers` events for new resources.
	 * @param resources - Sub-resource entries captured during the page load
	 */
	#handleResources(resources: ResourceEntry[]) {
		for (const { resource, pageUrl } of resources) {
			const { isNew } = handleResourceResponse(
				resource as CrawlerEventTypes['response']['resource'],
				this.#resources,
			);
			if (isNew) {
				void this.emit('response', {
					resource: resource as CrawlerEventTypes['response']['resource'],
				});
			}
			void this.emit('responseReferrers', {
				url: pageUrl,
				src: resource.url.withoutHash,
			});
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
	 * @param paginationState - Mutable state for predicted pagination cascade prevention
	 * @param paginationState.lastPushedUrl
	 * @param paginationState.lastPushedWasPredicted
	 * @param concurrency - Current concurrency level, used to determine predicted URL count
	 */
	#handleResult(
		result: ScrapeResult,
		url: ExURL,
		enqueue: (...urls: ExURL[]) => Promise<void>,
		paginationState?: { lastPushedUrl: string | null; lastPushedWasPredicted: boolean },
		concurrency?: number,
	) {
		switch (result.type) {
			case 'success': {
				if (!result.pageData) break;
				handleScrapeEnd(
					result.pageData,
					this.#linkList,
					this.#scope,
					this.#options,
					(newUrl, opts) => {
						this.#linkList.add(newUrl, opts);
						void enqueue(newUrl);

						// Predicted pagination detection
						if (!paginationState || !concurrency) return;

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

						paginationState.lastPushedUrl = newUrl.withoutHashAndAuth;
						paginationState.lastPushedWasPredicted = false;
					},
				);
				if (result.pageData.isExternal) {
					void this.emit('externalPage', { result: result.pageData });
				} else {
					void this.emit('page', { result: result.pageData });
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
					if (pageResult.isExternal) {
						void this.emit('externalPage', { result: pageResult });
					} else {
						void this.emit('page', { result: pageResult });
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
	 * Launches a fresh Puppeteer browser, runs the beholder scraper, and cleans up.
	 *
	 * WHY per-URL browser: Each URL gets its own browser instance to ensure
	 * complete isolation (cookies, cache, service workers). The browser is always
	 * closed in the `finally` block, even on error.
	 * @param url - Target URL to scrape
	 * @param update - Callback for progress messages
	 * @param isExternal - Whether the URL is external to the crawl scope
	 * @param metadataOnly - When true, only extract title metadata
	 * @param headCheckResult - Optional HEAD result to pass to the scraper, avoiding a redundant request
	 * @returns The scrape result from beholder
	 */
	async #launchBrowserAndScrape(
		url: ExURL,
		update: (log: string) => void,
		isExternal: boolean,
		metadataOnly: boolean,
		headCheckResult?: PageData,
	): Promise<ScrapeResult> {
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

		try {
			update('Creating page%dots%');
			const page = await browser.newPage();
			await page.setUserAgent(this.#options.userAgent);
			// Defence-in-depth: beholder sets Authorization via setExtraHTTPHeaders,
			// but page.authenticate() handles Chromium-level HTTP auth challenges
			// (401 + WWW-Authenticate) that setExtraHTTPHeaders cannot cover.
			if (url.username && url.password) {
				await page.authenticate({
					username: url.username,
					password: url.password,
				});
			}
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

			const result = await scraper.scrapeStart(page, url, {
				isExternal,
				captureImages: !isExternal && this.#options.captureImages,
				excludeKeywords: this.#options.excludeKeywords,
				disableQueries: this.#options.disableQueries,
				metadataOnly,
				retries: this.#options.retry,
				headCheckResult,
			});

			update('Closing browser%dots%');
			return result;
		} catch (error) {
			return {
				type: 'error',
				resources: [],
				error: {
					name: error instanceof Error ? error.name : 'Error',
					message: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					shutdown: true,
				},
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
	 * Runs the deal-based concurrent crawl loop.
	 *
	 * WHY deal(): The `@d-zero/dealer` pattern provides concurrent item processing
	 * with a dynamic queue — new URLs discovered during scraping are pushed via the
	 * `push` callback and automatically scheduled. The `onPush` deduplication ensures
	 * each URL is processed at most once (protocol-agnostic comparison).
	 * @param initialUrls - Starting URLs to seed the deal queue
	 * @param resumeOffset - Number of URLs already scraped in a previous session,
	 *   added to the progress counter for accurate display
	 */
	async #runDeal(initialUrls: ExURL[], resumeOffset = 0) {
		const seen = new Set<string>(
			initialUrls.map((u) => protocolAgnosticKey(u.withoutHashAndAuth)),
		);

		// Add scraped URLs to seen to prevent re-processing during resume
		for (const url of this.#resumedScraped) {
			seen.add(protocolAgnosticKey(url));
		}

		// external URL の追跡（target は deal の total/done から導出）
		const externalUrls = new Set<string>();
		const externalDoneUrls = new Set<string>();

		// 初期 URL を分類（onPush を通らないため）
		for (const url of initialUrls) {
			if (findScopeEntry(url, this.#scope, this.#options) === null) {
				externalUrls.add(protocolAgnosticKey(url.withoutHashAndAuth));
			}
		}

		const concurrency = this.#options.parallels
			? Math.max(this.#options.parallels, 1)
			: Crawler.MAX_PROCESS_LENGTH;

		// Predicted pagination state
		const paginationState = {
			lastPushedUrl: null as string | null,
			lastPushedWasPredicted: false,
		};

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
					const log = createTimedUpdate(update, this.#options.verbose);

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
							void this.emit('externalPage', { result: pageData });
							log(c.dim('External (skip fetch)'));
							return;
						}

						const metadataOnly = this.#linkList.isMetadataOnly(url.withoutHash);
						const isPredicted = this.#linkList.isPredicted(url.withoutHashAndAuth);

						log('Scraping%dots%');
						const result = await this.#scrapePage(url, log, metadataOnly, _index);

						// Discard predicted URLs that failed (404, error, etc.)
						if (isPredicted && shouldDiscardPredicted(result)) {
							handleIgnoreAndSkip(url, this.#linkList, this.#scope, this.#options);
							log(c.dim('Predicted (discarded)'));
							return;
						}

						log('Saving results%dots%');
						this.#handleResult(result, url, enqueue, paginationState, concurrency);
						this.#handleResources(result.resources);
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
				interval: this.#options.interval,
				verbose: this.#options.verbose || !process.stdout.isTTY,
				signal: this.#abortController.signal,
				header: (_progress, done, total, limit) => {
					return formatCrawlProgress({
						done,
						total,
						resumeOffset,
						externalTotal: externalUrls.size,
						externalDone: externalDoneUrls.size,
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
	 * @returns The scrape result
	 */
	async #scrapePage(
		url: ExURL,
		update: (log: string) => void,
		metadataOnly: boolean,
		laneIndex: number,
	): Promise<ScrapeResult> {
		const isExternal = findScopeEntry(url, this.#scope, this.#options) === null;

		// Non-HTTP protocols (mailto:, tel:, etc.) — let the scraper handle early return
		if (!url.isHTTP) {
			return this.#launchBrowserAndScrape(url, update, isExternal, metadataOnly);
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
				};
			}
		}

		// Pre-flight: lightweight HEAD request to check server availability
		update('HEAD request%dots%');
		let headCheckResult: PageData;
		try {
			headCheckResult = await this.#sendHeadRequest(url, isExternal, update, laneIndex);
		} catch (error) {
			// Server unreachable — skip browser launch entirely
			update(c.red('Unreachable'));
			return {
				type: 'error',
				resources: [],
				error: {
					name: error instanceof Error ? error.name : 'Error',
					message: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					shutdown: false,
				},
			};
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
					};
				} catch (error) {
					crawlerLog('Title GET failed for %s: %O', url.href, error);
				}
			}
			return {
				type: 'success',
				pageData: { ...headCheckResult, isTarget: false },
				resources: [],
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
			};
		}

		// HTML or unknown content type — launch browser with preflight result
		return this.#launchBrowserAndScrape(
			url,
			update,
			isExternal,
			metadataOnly,
			headCheckResult,
		);
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
		return retryCall(
			() => fetchDestination({ url, isExternal, userAgent: this.#options.userAgent }),
			{
				retries: this.#options.retry,
				label: 'HEAD request',
				onWait: (determinedInterval, retryCount, label, error) => {
					update(
						`${label}: ${error.message} — %countdown(${determinedInterval},fetchHead_${laneIndex}_${retryCount},s)%s (retry #${retryCount + 1})`,
					);
				},
				onGiveUp: (retryCount, error, label) => {
					update(
						c.red(`${label}: gave up after ${retryCount} retries — ${error.message}`),
					);
				},
			},
		);
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
