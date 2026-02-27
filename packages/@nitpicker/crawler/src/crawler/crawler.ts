import type { CrawlerEventTypes, CrawlerOptions } from './types.js';
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

import { detectPaginationPattern } from './detect-pagination-pattern.js';
import { fetchDestination } from './fetch-destination.js';
import { generatePredictedUrls } from './generate-predicted-urls.js';
import { handleIgnoreAndSkip } from './handle-ignore-and-skip.js';
import { handleResourceResponse } from './handle-resource-response.js';
import { handleScrapeEnd } from './handle-scrape-end.js';
import { handleScrapeError } from './handle-scrape-error.js';
import { injectScopeAuth } from './inject-scope-auth.js';
import { isExternalUrl } from './is-external-url.js';
import LinkList from './link-list.js';
import { linkToPageData } from './link-to-page-data.js';
import { protocolAgnosticKey } from './protocol-agnostic-key.js';
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
	/** Flag set by `abort()` to signal in-progress tasks to exit early. */
	#aborted = false;
	/** Tracks discovered URLs, their scrape status, and deduplication. */
	readonly #linkList = new LinkList();
	/** Merged crawler configuration (user overrides + defaults). */
	readonly #options: CrawlerOptions;
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
			scope: options?.scope ?? [],
			excludes: options?.excludes || [],
			excludeKeywords: options?.excludeKeywords || [],
			excludeUrls: options?.excludeUrls || [],
			maxExcludedDepth: options?.maxExcludedDepth || 10,
			retry: options?.retry ?? 3,
			disableQueries: options?.disableQueries ?? false,
			verbose: options?.verbose ?? false,
			userAgent: options?.userAgent || `Nitpicker/${pkg.version}`,
			ignoreRobots: options?.ignoreRobots ?? false,
		};

		this.#robotsChecker = new RobotsChecker(
			this.#options.userAgent,
			!this.#options.ignoreRobots,
		);

		for (const urlStr of this.#options.scope) {
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
	 * Sets the aborted flag and immediately emits a `crawlEnd` event.
	 * In-progress scrape tasks will check the flag and exit early.
	 */
	abort() {
		this.#aborted = true;
		void this.emit('crawlEnd', {});
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
	 * Start crawling from a single root URL.
	 *
	 * Adds the root URL to the scope (if not already present) and the link list,
	 * then begins the deal-based concurrent crawl. Discovered child pages are
	 * automatically added to the queue when recursive mode is enabled.
	 * @param url - The root URL to begin crawling from.
	 */
	start(url: ExURL) {
		const existing = this.#scope.get(url.hostname) || [];
		if (!existing.some((u) => u.href === url.href)) {
			this.#scope.set(url.hostname, [...existing, url]);
		}
		this.#linkList.add(url);

		const isResuming = this.#resumedScraped.length > 0;
		const initialUrls = isResuming ? this.#resumedPending : [url];
		const resumeOffset = this.#resumedScraped.length;

		if (initialUrls.length === 0) {
			crawlerLog('Crawl End (nothing to resume)');
			void this.emit('crawlEnd', {});
			return;
		}

		void this.#runDeal(initialUrls, resumeOffset).catch((error) => {
			crawlerLog('runDeal error: %O', error);
			void this.emit('error', {
				pid: process.pid,
				isMainProcess: true,
				url: url.href,
				error: error instanceof Error ? error : new Error(String(error)),
			});
			void this.emit('crawlEnd', {});
		});
	}

	/**
	 * Start crawling a pre-defined list of URLs in non-recursive mode.
	 *
	 * Each URL in the list is added to the scope and the link list. Recursive
	 * crawling is disabled; only the provided URLs will be scraped.
	 * @param pageList - The list of URLs to crawl. Must contain at least one URL.
	 * @throws {Error} If the page list is empty.
	 */
	startMultiple(pageList: ExURL[]) {
		if (!pageList[0]) {
			throw new Error('pageList is empty');
		}

		const scopeMap = new Map<string, Set<string>>();
		for (const pageUrl of pageList) {
			const existing = this.#scope.get(pageUrl.hostname) || [];
			const existingHrefs =
				scopeMap.get(pageUrl.hostname) || new Set(existing.map((u) => u.href));

			if (!existingHrefs.has(pageUrl.href)) {
				this.#scope.set(pageUrl.hostname, [...existing, pageUrl]);
				existingHrefs.add(pageUrl.href);
			}

			scopeMap.set(pageUrl.hostname, existingHrefs);
			this.#linkList.add(pageUrl);
		}
		this.#options.recursive = false;
		this.#options.fromList = true;
		void this.#runDeal(pageList).catch((error) => {
			crawlerLog('runDeal error: %O', error);
			void this.emit('error', {
				pid: process.pid,
				isMainProcess: true,
				url: pageList[0]!.href,
				error: error instanceof Error ? error : new Error(String(error)),
			});
			void this.emit('crawlEnd', {});
		});
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
	 * @param push - Dealer's push callback to enqueue newly discovered URLs
	 * @param paginationState - Mutable state for predicted pagination cascade prevention
	 * @param paginationState.lastPushedUrl
	 * @param paginationState.lastPushedWasPredicted
	 * @param concurrency - Current concurrency level, used to determine predicted URL count
	 */
	#handleResult(
		result: ScrapeResult,
		url: ExURL,
		push: (...items: ExURL[]) => Promise<void>,
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
						void push(newUrl);

						// Predicted pagination detection
						if (!paginationState || !concurrency) return;

						// metadataOnly / external: update tracking but skip pattern detection
						if (opts?.metadataOnly || isExternalUrl(newUrl, this.#scope)) {
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
								for (const specUrlStr of urls) {
									const specUrl = parseUrl(specUrlStr, this.#options);
									if (specUrl) {
										this.#linkList.add(specUrl, { predicted: true });
										void push(specUrl);
									}
								}
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
					isExternal: isExternalUrl(result.ignored.url, this.#scope),
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
			const scraper = new Scraper();

			scraper.on('changePhase', (e) => {
				const msg = formatPhaseLog(e);
				if (msg) {
					update(msg);
				}
				void this.emit('changePhase', e);
			});

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
			await browser.close().catch(() => {});
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
			if (isExternalUrl(url, this.#scope)) {
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
			(url, update, _index, setLineHeader, push) => {
				const isExternal = isExternalUrl(url, this.#scope);
				const urlText = isExternal ? c.dim(url.href) : c.cyan(url.href);
				setLineHeader(`%braille% ${urlText}: `);
				injectScopeAuth(url, this.#scope);
				this.#linkList.add(url);
				this.#linkList.progress(url);

				return async () => {
					if (this.#aborted) return;
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
						const result = await this.#scrapePage(url, log, metadataOnly);

						// Discard predicted URLs that failed (404, error, etc.)
						if (isPredicted && shouldDiscardPredicted(result)) {
							handleIgnoreAndSkip(url, this.#linkList, this.#scope, this.#options);
							log(c.dim('Predicted (discarded)'));
							return;
						}

						log('Saving results%dots%');
						this.#handleResult(result, url, push, paginationState, concurrency);
						this.#handleResources(result.resources);
						log(formatResultSummary(result));
					} finally {
						if (isExternal) {
							externalDoneUrls.add(protocolAgnosticKey(url.withoutHashAndAuth));
						}
					}
				};
			},
			{
				limit: concurrency,
				interval: this.#options.interval,
				verbose: this.#options.verbose || !process.stdout.isTTY,
				header: (_progress, done, total, limit) => {
					const allDone = done + resumeOffset;
					const allTotal = total + resumeOffset;
					const extTotal = externalUrls.size;
					const extDone = externalDoneUrls.size;
					const pct = allTotal > 0 ? Math.round((allDone / allTotal) * 100) : 0;
					return (
						c.bold(`Crawling: ${allDone - extDone}/${allTotal - extTotal}`) +
						c.dim(`(${extDone}/${extTotal})`) +
						c.bold(` (${pct}%) [${limit} parallel]`)
					);
				},
				onPush: (url) => {
					const key = protocolAgnosticKey(url.withoutHashAndAuth);
					if (seen.has(key)) return false;
					seen.add(key);
					if (isExternalUrl(url, this.#scope)) {
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
	 * @returns The scrape result
	 */
	async #scrapePage(
		url: ExURL,
		update: (log: string) => void,
		metadataOnly: boolean,
	): Promise<ScrapeResult> {
		const isExternal = isExternalUrl(url, this.#scope);

		// Non-HTTP protocols (mailto:, tel:, etc.) — let the scraper handle early return
		if (!url.isHTTP) {
			return this.#launchBrowserAndScrape(url, update, isExternal, metadataOnly);
		}

		// Pre-flight: lightweight HEAD request to check server availability
		update('HEAD request%dots%');
		let headCheckResult: PageData;
		try {
			headCheckResult = await this.#sendHeadRequest(url, isExternal, update);
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
				headCheckResult.contentType === 'text/html'
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
			headCheckResult.contentType !== 'text/html'
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
	 * @returns Lightweight page data from the HEAD response
	 */
	async #sendHeadRequest(
		url: ExURL,
		isExternal: boolean,
		update: (msg: string) => void,
	): Promise<PageData> {
		return retryCall(
			() => fetchDestination({ url, isExternal, userAgent: this.#options.userAgent }),
			{
				retries: this.#options.retry,
				label: 'HEAD request',
				onWait: (determinedInterval, retryCount, label, error) => {
					update(
						`${label}: ${error.message} — %countdown(${determinedInterval},fetchHead_${retryCount},s)%s (retry #${retryCount + 1})`,
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
			return e.message;
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
