import type { Config } from './archive/types.js';
import type { NetworkProbe } from './crawler/probe-network.js';
import type { CrawlerOptions, InventoryMode } from './crawler/types.js';
import type { CrawlEvent, InventoryRunAggregates } from './types.js';
import type { ExURL } from '@d-zero/shared/parse-url';

import { copyFile, unlink as unlinkFile } from 'node:fs/promises';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { sortUrl } from '@d-zero/shared/sort-url';
import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';

import pkg from '../package.json' with { type: 'json' };

import Archive from './archive/archive.js';
import { REQUIRED_FORMAT_VERSION } from './archive/meta/assert-compatible-version.js';
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
import { crawlerLog, log } from './debug.js';
import { normalizeToArray } from './normalize-to-array.js';
import { resolveOutputPath } from './resolve-output-path.js';
import { resourceRowToLookupResult } from './resource-row-to-lookup-result.js';
import { cleanObject } from './utils/object/clean-object.js';
import { WriteQueue } from './write-queue.js';

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
	/** Number of source-file lines the CLI warned-and-dropped for failing URL validation, before `inventoryUrls` was ever built. Recorded on the audit row as `inventory_runs.invalid_skipped`. */
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
 * or {@link CrawlerOrchestrator.resume}; the constructor is private.
 * @example
 * ```ts
 * const orchestrator = await CrawlerOrchestrator.crawling(['https://example.com'], { recursive: true });
 * await orchestrator.write();
 * ```
 */
export class CrawlerOrchestrator extends EventEmitter<CrawlEvent> {
	/** The archive instance for persisting crawl results to SQLite + tar. */
	readonly #archive: Archive;
	/** The crawler engine that discovers and scrapes pages. */
	readonly #crawler: Crawler;
	/** Whether the crawl was started from a pre-defined URL list (non-recursive mode). */
	readonly #fromList: boolean;
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
		this.#archive = archive;
		this.#archive.on('error', (e) => {
			this.#crawler.abort();
			void this.emit('error', {
				pid: process.pid,
				isMainProcess: true,
				url: null,
				isExternal: false,
				error: e instanceof Error ? e : new Error(String(e)),
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
		});
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
	 * @param list - The list of parsed URLs to crawl. May be empty when a resumed
	 *   session already has pending pages queued (for example `--retry-failed`).
	 * @param opts - Optional crawl overrides.
	 * @param opts.recursive - Whether discovered URLs are followed. Defaults to
	 *   `!fromList` (recursive unless the archive was created from a URL list), so
	 *   existing callers keep their behaviour; the retry flow passes it explicitly.
	 * @returns A promise that resolves when crawling is complete.
	 */
	async crawling(list: ExURL[], opts?: { recursive?: boolean }) {
		const writeQueue = this.#writeQueue;
		// Per-session state, like `Crawler`'s own `#successfulHosts.clear()` /
		// `#networkGate.open()` reset at the start of `#runDeal` — a fresh
		// session must not inherit a dangling outage id from a prior one.
		this.#openNetworkOutageId = null;
		this.#openNetworkOutageStartedAt = null;

		return new Promise<void>((resolve, reject) => {
			this.#crawler.on('error', (error) => {
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

			this.#crawler.on('page', ({ result, source }) => {
				writeQueue
					.enqueue(() => this.#archive.setPage(result, source))
					.catch((error) => reject(error));
			});

			this.#crawler.on('externalPage', ({ result, source }) => {
				writeQueue
					.enqueue(() => this.#archive.setExternalPage(result, source))
					.catch((error) => reject(error));
			});

			this.#crawler.on('skip', ({ url, reason, isExternal }) => {
				writeQueue
					.enqueue(() => this.#archive.setSkippedPage(url, reason, isExternal))
					.catch((error) => reject(error));
			});

			this.#crawler.on('pageError', ({ url, phase, message, isExternal }) => {
				writeQueue
					.enqueue(() => this.#archive.addPageError(url, phase, message, isExternal))
					.catch((error) => reject(error));
			});

			this.#crawler.on('redirect', ({ result, source }) => {
				writeQueue
					.enqueue(() => this.#archive.setRedirect(result, source))
					.catch((error) => reject(error));
				void this.emit('redirect', { result });
			});

			this.#crawler.on(
				'networkOutageConfirmed',
				({ startedAt, detectedAt, probeHost, triggerErrorCount, triggerHostCount }) => {
					crawlerLog(
						'Network outage confirmed: probeHost=%s triggerErrorCount=%d triggerHostCount=%d',
						probeHost,
						triggerErrorCount,
						triggerHostCount,
					);

					// event notice; mirrors `#finalizeCrawlSession`'s unconditional
					// `console.error` for the DNS-burn short-circuit summary.
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

			this.#crawler.on('networkOutageRecovered', ({ endedAt }) => {
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

			this.#crawler.on('response', ({ resource, source }) => {
				writeQueue
					.enqueue(() => this.#archive.setResources(resource, source))
					.catch((error) => reject(error));
			});

			this.#crawler.on('responseReferrers', (resource) => {
				writeQueue
					.enqueue(() => this.#archive.setResourcesReferrers(resource))
					.catch((error) => reject(error));
			});

			this.#crawler.on('consoleLogs', ({ pageUrl, redirectPaths, entries }) => {
				writeQueue
					.enqueue(() => this.#archive.setConsoleLogs(pageUrl, redirectPaths, entries))
					.catch((error) => reject(error));
			});

			this.#crawler.on('crawlEnd', () => {
				writeQueue
					.drain()
					.then(() => resolve())
					.catch((error) => reject(error));
			});

			this.#crawler.start(list, { recursive: opts?.recursive ?? !this.#fromList });
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
	 * Emits `writeFileStart` before writing and `writeFileEnd` after
	 * the write completes successfully.
	 */
	async write() {
		void this.emit('writeFileStart', { filePath: this.#archive.filePath });
		await this.#archive.write();
		void this.emit('writeFileEnd', { filePath: this.#archive.filePath });
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
		await orchestrator.crawling(list);
		log('Crawling completed');
		CrawlerOrchestrator.#finalizeCrawlSession();
		log('Set order natural URL sort');
		await archive.setUrlOrder();
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
	 * is restored to keep the original archive intact.
	 *
	 * List-mode archives (`info.fromList === true`) are rejected because their
	 * pages are all metadata-only and cannot host a recursive append.
	 * @param archivePath - Absolute or relative path to the existing `.nitpicker`.
	 * @param newUrls - New root URLs to add and crawl.
	 * @param options - Optional config overrides applied on top of the archived config.
	 * @param initializedCallback - Optional callback invoked after initialization but before crawling resumes.
	 * @returns The orchestrator instance after the append crawl completes.
	 * @throws {Error} When `newUrls` is empty, the archive is in list mode, or it cannot be parsed.
	 */
	static async append(
		archivePath: string,
		newUrls: string[],
		options?: Partial<CrawlConfig>,
		initializedCallback?: CrawlInitializedCallback,
	) {
		if (newUrls.length === 0) {
			throw new Error('append: newUrls is empty');
		}
		const cwd = options?.cwd ?? process.cwd();
		const absFilePath = path.isAbsolute(archivePath)
			? archivePath
			: path.resolve(cwd, archivePath);

		// See `ArchiveOpenOptions.openPluginData` for why this must be `true`
		// on every writer path that calls `write()`.
		const archive = await Archive.open({
			filePath: absFilePath,
			cwd,
			openPluginData: true,
		});
		// Any throw between here and the successful return must release the
		// archive lock and clean up tmpDir; the caller's `close()` only runs on
		// the happy path. Errors from `close()` itself are intentionally
		// best-effort: the original error is what matters.
		try {
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
			};

			const backupPath = absFilePath + '.bak';
			await copyFile(absFilePath, backupPath);

			try {
				await archive.updateConfig(mergedConfig);

				const scopeMap = new Map<string, ExURL[]>();
				for (const raw of mergedRoots) {
					const parsed = parseUrl(raw, archived);
					if (!parsed) continue;
					const existing = scopeMap.get(parsed.hostname) ?? [];
					scopeMap.set(parsed.hostname, [...existing, parsed]);
				}
				await archive.repromoteExternalPages(scopeMap, archived);

				const orchestrator = new CrawlerOrchestrator(archive, {
					...mergedConfig,
					roots: mergedRoots,
				});
				const { scraped, pending } = await archive.getCrawlingState();
				const resources = await archive.getResourceUrlList();
				const pagesScrapedOffset = await archive.getScrapedHtmlPageCount();
				orchestrator.#crawler.resume(pending, scraped, resources, pagesScrapedOffset);
				if (initializedCallback) {
					await initializedCallback(orchestrator, mergedConfig);
				}
				log('Start appending');
				log('Archive %s', absFilePath);
				log('New roots %O', newRoots);
				log('Merged roots %O', mergedRoots);
				await CrawlerOrchestrator.#preloadDnsBurnedHostCache(archive);
				await orchestrator.crawling(newParsed);
				CrawlerOrchestrator.#finalizeCrawlSession();
				await archive.setUrlOrder();
				await ignoreEnoent(unlinkFile(backupPath));
				return orchestrator;
			} catch (error) {
				try {
					await copyFile(backupPath, absFilePath);
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
	 * 3. Reject archives with unfinished `pending` URLs — those would inherit
	 *    the inventory `source` label by mistake. Operator must resume /
	 *    retry-failed first.
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
	 * 7. Make `<archive>.bak`. Anything thrown beyond this point restores
	 *    from the backup.
	 * 8. HEAD-probe each novel URL. Responses classified as HTML are queued
	 *    as Crawler seeds (`'inventory-seed'`); everything else is recorded
	 *    in `resources` directly as `'inventory-seed'` (no browser launch).
	 * 9. If any HTML seeds exist, start a Crawler with
	 *    `inventoryMode = { seedUrls }` so the rendered page and every newly
	 *    discovered downstream link is labelled correctly. `resume` is fed
	 *    the existing `scraped` / `resources` sets so links into already-
	 *    crawled pages stop at the seen-gate without re-rendering.
	 * 10. Drop the backup on success; restore it on any throw.
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
	 * @returns The orchestrator instance after a successful inventory pass.
	 * @throws {Error} When `inventoryUrls` is empty, the archive is in list mode, or pending URLs from a previous crawl remain unresolved.
	 */
	static async inventory(
		archivePath: string,
		inventoryUrls: string[],
		options?: Partial<CrawlConfig>,
		initializedCallback?: CrawlInitializedCallback,
		source: InventorySource | null = null,
	) {
		if (inventoryUrls.length === 0) {
			throw new Error('inventory: URL list is empty');
		}
		const cwd = options?.cwd ?? process.cwd();
		const absFilePath = path.isAbsolute(archivePath)
			? archivePath
			: path.resolve(cwd, archivePath);

		// See `ArchiveOpenOptions.openPluginData` for why this must be `true`
		// on every writer path that calls `write()`.
		const archive = await Archive.open({
			filePath: absFilePath,
			cwd,
			openPluginData: true,
		});
		try {
			const archived = await archive.getConfig();
			if (archived.fromList) {
				throw new Error(
					'Cannot run inventory on a list-mode archive: this archive was created with --list/--list-file and contains metadata-only pages. Create a fresh archive instead.',
				);
			}

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
				// eslint-disable-next-line no-console -- operator-facing warning, must be visible regardless of DEBUG filters
				console.warn(
					`inventory: archive has ${pending.length} pending URLs from a previous crawl. Proceeding — crawled-wins priority keeps their labels stable. Consider \`--resume\` first if you want the prior work finalized.`,
				);
			}

			// Archive the exact source bytes before scope classification, so
			// even a run that discards every URL (out-of-scope or already
			// known — see `novelUrls.length === 0` below) still leaves a
			// recoverable copy of what was fed in. Content-hash-named, so a
			// second `--inventory` pass with the same list is a no-op write.
			if (source) {
				await archive.saveInventorySourceList(source.sha256, source.bytes);
			}

			// Parse + scope-classify the candidate URLs. sortUrl drops
			// unparseable strings; findScopeEntry separates in-scope from
			// out-of-scope.
			const parsedAll = sortUrl(inventoryUrls, archived);
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
					'[inventory] %d URL(s) skipped (outside archived scope: %O)',
					outOfScope,
					archived.roots,
				);
			}

			// Drop URLs that are already represented in the archive (either
			// as pages or resources). Comparison key is `withoutHashAndAuth`
			// to mirror what `resolveContentItemId` / `insertResource` actually store.
			// Two independent reads — Promise.all halves the wait on large
			// archives where each `WHERE url IN (?)` chunk costs real I/O.
			const candidateUrls = inScope.map((u) => u.withoutHashAndAuth);
			const [existingPageUrlList, existingResourceUrlList] = await Promise.all([
				archive.getExistingPageUrls(candidateUrls),
				archive.getExistingResourceUrls(candidateUrls),
			]);
			const existingPageUrls = new Set(existingPageUrlList);
			const existingResourceUrls = new Set(existingResourceUrlList);
			const novelUrls = inScope.filter((u) => {
				const key = u.withoutHashAndAuth;
				return !existingPageUrls.has(key) && !existingResourceUrls.has(key);
			});
			const knownCount = existingPageUrls.size + existingResourceUrls.size;
			log(
				'[inventory] %d in-scope, %d already in archive, %d new',
				inScope.length,
				knownCount,
				novelUrls.length,
			);

			if (novelUrls.length === 0) {
				// Nothing to do — release the archive cleanly without taking a
				// backup. The orchestrator returned here is empty; the caller
				// should only invoke `close` on it.
				const noopConfig: Config = {
					...archived,
					...cleanObject(options),
				};
				const orchestrator = new CrawlerOrchestrator(archive, noopConfig);
				if (initializedCallback) {
					await initializedCallback(orchestrator, noopConfig);
				}
				return orchestrator;
			}

			const backupPath = absFilePath + '.bak';
			await copyFile(absFilePath, backupPath);

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
				// Classify novel URLs by URL-extension heuristic (no I/O).
				// Source file lists come from `ls` on the doc-root, so the
				// extension reflects the real file type — a HEAD pre-flight
				// here would be pure wasted I/O. Edge cases:
				//
				// - `.html` returning 404 / 200: the normal crawler HEAD/GET
				//   path absorbs this because every HTML-classified URL is
				//   fed through the dealer and gets its real HEAD/GET there.
				//
				// - Extensionless API endpoints (e.g. `/api/foo`) that the
				//   server returns as `text/html`: `isLikelyHtmlUrl` accepts
				//   them as HTML so the dealer's render path runs — the
				//   real content-type wins downstream.
				//
				// - `.aspx` / `.do` / `.jsp` / other server-handler
				//   extensions that the heuristic does NOT recognise as
				//   HTML: these are classified as non-HTML here, recorded
				//   as `resources` rows with all-null metadata, and never
				//   get a HEAD/GET probe. The accepted trade-off for
				//   `--inventory`'s "list of static-looking server files"
				//   contract; sites that mix server-handlers into the
				//   inventory list will need a follow-up `--retry-failed`
				//   pass (or a re-`--inventory` with the corrected list)
				//   to populate metadata.
				//
				// non-HTML rows are recorded with null status/content-type
				// which is sufficient for `listUnusedResources` (referrer
				// count = 0) but means downstream consumers must treat
				// null as "not probed" rather than "failed".
				const rawHtmlSeeds: ExURL[] = [];
				const nonHtmlSeeds: ExURL[] = [];
				for (const url of novelUrls) {
					if (isLikelyHtmlUrl(url)) {
						rawHtmlSeeds.push(url);
					} else {
						nonHtmlSeeds.push(url);
					}
				}
				// Dedup HTML seeds by `protocolAgnosticKey` so an inventory
				// list that mixes `http://` and `https://` for the same
				// origin does not produce two `pages` rows that the dealer
				// later collapses to one — the loser would otherwise stay
				// `scraped=0, source='inventory-seed'` forever and look like
				// a real recovery candidate on `--resume`. `getExistingPageUrls`
				// keys on the full URL (with protocol), so it cannot catch
				// the cross-scheme duplicate; this is the dedup boundary.
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
				// Bulk-record non-HTML novel URLs in `resources` as
				// `source='inventory-seed'` placeholders. A
				// per-URL `await setResources(...)` loop would spend minutes
				// inside the `.bak`-protected window on large inventory
				// lists; the chunked bulk path collapses N round-trips
				// to N/500.
				await archive.insertInventoryResources(nonHtmlSeeds);
				// Pre-insert HTML seeds as `scraped = 0`,
				// `source = 'inventory-seed'` placeholders *before* the
				// scrape phase, so a Ctrl+C between here and `setPage`
				// cannot lose the URL. The strict-pending set picks
				// these rows up on the next `--resume` via the
				// `OR p.source != 'crawled'` clause.
				await archive.insertInventorySeeds(htmlSeeds);
				log(
					'[inventory] %d HTML seed(s), %d non-HTML resource(s) recorded',
					htmlSeeds.length,
					nonHtmlSeeds.length,
				);
				// Audit row is written *inside* the `.bak` window: a libsql
				// hiccup or transient lock on the INSERT aborts the ingestion
				// and the `.bak` restore wipes the pre-inserted seeds too,
				// so "either the whole run took or none of it did" holds at
				// the ingestion boundary. Audit failures are deliberately
				// NOT swallowed — inside the `.bak` window a restore is
				// safe and useful (see
				// {@link CrawlerOrchestrator.#writeInventoryRunRow}).
				await CrawlerOrchestrator.#writeInventoryRunRow(archive, {
					inventoryUrlsCount: inventoryUrls.length,
					htmlSeedsCount: htmlSeeds.length,
					nonHtmlCount: nonHtmlSeeds.length,
					outOfScope,
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
					...archived,
					...cleanObject(options),
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
					const orchestrator = new CrawlerOrchestrator(archive, orchestratorOptions);
					// Re-read pending *after* the pre-insert so the strict-
					// pending set includes the freshly inserted
					// `inventory-seed` rows; feed that into `crawler.resume`
					// and start a seedless `crawling([])` — the same pattern
					// `retryFailed` uses to drive the dealer from the
					// pending set alone (see retryFailed's
					// `crawling([], { recursive })` invocation).
					const { scraped: scrapedAfter, pending: pendingAfter } =
						await archive.getCrawlingState();
					const resources = await archive.getResourceUrlList();
					// Pre-existing rendered HTML page count seeds the
					// session-spanning `pagesScraped` counter so the progress
					// header reads `internalDone(cumulative pagesScraped)`
					// rather than session-only — matches the `append` /
					// `retryFailed` / `resume` paths and avoids users reading
					// the parenthesised number as "inner pages dropped to N".
					const pagesScrapedOffset = await archive.getScrapedHtmlPageCount();
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
					await orchestrator.crawling([], { recursive: true });
					CrawlerOrchestrator.#finalizeCrawlSession();
					await archive.setUrlOrder();
					return orchestrator;
				}

				// Only non-HTML URLs were imported — nothing left to render,
				// but still update sort order and finalize.
				const orchestrator = new CrawlerOrchestrator(archive, orchestratorOptions);
				if (initializedCallback) {
					await initializedCallback(orchestrator, baseConfig);
				}
				await archive.setUrlOrder();
				return orchestrator;
			} catch (error) {
				if (ingestionComplete) {
					// Scrape phase failed; the pre-inserted seeds + audit
					// row are durable inside `tmpDir/db.sqlite` but not yet
					// on disk as a `.nitpicker` tar. The outer catch below
					// runs `archive.close()`, which sees the original
					// (pre-inventory) `.nitpicker` already on disk and
					// would just `remove(tmpDir)` — silently wiping every
					// `inventory-seed` row and the audit row.
					//
					// Persist the ingested state ourselves before letting
					// the outer catch unwind, then re-throw so the operator
					// learns about the scrape failure (and can recover via
					// `crawl --resume <archive>`). `releaseHandle` shares
					// the orchestrator's `#closeOnce` guard, so the outer
					// catch's `close()` becomes a no-op for the destructive
					// step and only runs `releaseLock` cleanup.
					try {
						await archive.write();
						await archive.releaseHandle();
					} catch (persistError) {
						throw new AggregateError(
							[error, persistError],
							'inventory scrape phase failed AND persisting the ingested state to disk also failed. The archive may be in an inconsistent state — check tmpDir.',
						);
					}
					throw error;
				}
				try {
					await copyFile(backupPath, absFilePath);
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
	 * intact.
	 *
	 * List-mode archives (`info.fromList === true`) are rejected for the same
	 * reason as {@link CrawlerOrchestrator.append}: their pages are metadata-only.
	 * @param archivePath - Absolute or relative path to the existing `.nitpicker`.
	 * @param options - Optional config overrides applied on top of the archived config.
	 * @param initializedCallback - Optional callback invoked after initialization but before crawling resumes.
	 * @returns The orchestrator instance after the retry crawl completes.
	 * @throws {Error} When the archive is in list mode or has no parseable roots.
	 */
	static async retryFailed(
		archivePath: string,
		options?: Partial<CrawlConfig>,
		initializedCallback?: CrawlInitializedCallback,
	) {
		const cwd = options?.cwd ?? process.cwd();
		const absFilePath = path.isAbsolute(archivePath)
			? archivePath
			: path.resolve(cwd, archivePath);

		// See `ArchiveOpenOptions.openPluginData` for why this must be `true`
		// on every writer path that calls `write()`.
		const archive = await Archive.open({
			filePath: absFilePath,
			cwd,
			openPluginData: true,
		});
		// Any throw between here and the successful return must release the
		// archive lock and clean up tmpDir; the caller's `close()` only runs on
		// the happy path.
		try {
			const archived = await archive.getConfig();
			if (archived.fromList) {
				throw new Error(
					'Cannot retry a list-mode archive: this archive was created with --list/--list-file and contains metadata-only pages. Create a fresh archive instead.',
				);
			}

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
			await copyFile(absFilePath, backupPath);

			try {
				const resetUrls = await archive.resetFailedPages();
				log('Start retrying failed pages');
				log('Archive %s', absFilePath);
				log('Reset %d failed page(s)', resetUrls.length);

				const orchestrator = new CrawlerOrchestrator(archive, config);
				const { scraped, pending } = await archive.getCrawlingState();
				const resources = await archive.getResourceUrlList();
				const pagesScrapedOffset = await archive.getScrapedHtmlPageCount();
				orchestrator.#crawler.resume(pending, scraped, resources, pagesScrapedOffset);
				if (initializedCallback) {
					await initializedCallback(orchestrator, config);
				}
				await CrawlerOrchestrator.#preloadDnsBurnedHostCache(archive);
				await orchestrator.crawling([], { recursive: config.recursive });
				CrawlerOrchestrator.#finalizeCrawlSession();
				await archive.setUrlOrder();
				await ignoreEnoent(unlinkFile(backupPath));
				return orchestrator;
			} catch (error) {
				try {
					await copyFile(backupPath, absFilePath);
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
	 * @returns A promise that resolves to the CrawlerOrchestrator instance after crawling completes.
	 * @throws {Error} If the archived URL is invalid.
	 */
	static async resume(
		stubPath: string,
		options?: Partial<CrawlConfig>,
		initializedCallback?: CrawlInitializedCallback,
	) {
		const archive = await Archive.resume(stubPath);
		const archivedConfig = await archive.getConfig();
		const config = {
			...archivedConfig,
			...cleanObject(options),
		};
		const orchestrator = new CrawlerOrchestrator(archive, config);
		const _url = await archive.getUrl();
		const url = parseUrl(_url, config);
		if (!url) {
			throw new Error(`URL (${_url}) is invalid`);
		}
		const { scraped, pending } = await archive.getCrawlingState();
		const resources = await archive.getResourceUrlList();
		const pagesScrapedOffset = await archive.getScrapedHtmlPageCount();
		orchestrator.#crawler.resume(pending, scraped, resources, pagesScrapedOffset);
		if (initializedCallback) {
			await initializedCallback(orchestrator, config);
		}
		log('Start resuming');
		log('Data %s', stubPath);
		log('URL %s', url.href);
		log('Config %O', config);
		await CrawlerOrchestrator.#preloadDnsBurnedHostCache(archive);
		await orchestrator.crawling([url]);
		CrawlerOrchestrator.#finalizeCrawlSession();
		return orchestrator;
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
	 * Persist one `inventory_runs` audit row inside the ingestion phase of a
	 * `--inventory` invocation, before the `.bak` is released. Lives as a
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
	 * {@link InventoryRunAggregates} for the privacy rationale.
	 *
	 * **Audit-write failures abort the ingestion phase.** Swallowing them
	 * would only be justified if the audit were the last write after the
	 * scrape (re-throwing there would wipe a completed crawl); inside the
	 * `.bak`-protected ingestion phase the
	 * trade-off flips. A failed audit row is restorable: the outer catch
	 * copies `.bak` back over the archive and the operator reruns the
	 * (short) ingestion from scratch. That keeps `inventory_runs` honest
	 * (no "ran but unrecorded" rows) at the cost of one rerun.
	 *
	 * Forward-compat: if an explicit `--label` flag is ever added, thread
	 * `labelOverride` through {@link inventory} into the `aggregates`
	 * shape so the auto-name can be overridden.
	 * @param archive - The opened archive to write the audit row into.
	 * @param aggregates - The counts captured during the inventory pass; see {@link InventoryRunAggregates}.
	 */
	static async #writeInventoryRunRow(
		archive: Archive,
		aggregates: InventoryRunAggregates,
	): Promise<void> {
		const ranAt = new Date().toISOString();
		await archive.recordInventoryRun({
			ran_at: ranAt,
			list_label: `inventory-${ranAt}`,
			source_file_sha256: aggregates.sourceFileSha256,
			total_lines: aggregates.inventoryUrlsCount,
			new_pages: aggregates.htmlSeedsCount,
			new_resources: aggregates.nonHtmlCount,
			scope_skipped: aggregates.outOfScope,
			invalid_skipped: aggregates.invalidSkipped,
		});
	}

	/**
	 * Tears down session-scoped crawler caches and prints a short-circuit
	 * summary if any URL fetches were skipped. Invoked at every
	 * crawl-session boundary (`crawling` / `append` / `inventory` /
	 * `retryFailed` / `resume`).
	 */
	static #finalizeCrawlSession(): void {
		const skipped = dnsBurnedHostShortCircuitCounter.count;
		if (skipped > 0) {
			// eslint-disable-next-line no-console
			console.error(`[preload] Short-circuited ${skipped} URL(s) on DNS-burned hosts`);
		}
		const { confirmedCount, totalDurationMs } = networkOutageSummaryCounter;
		if (confirmedCount > 0) {
			// eslint-disable-next-line no-console
			console.error(
				`[network] ${confirmedCount} outage(s), ${Math.round(totalDurationMs / 1000)}s total`,
			);
		}
		networkOutageSummaryCounter.confirmedCount = 0;
		networkOutageSummaryCounter.totalDurationMs = 0;
		clearDestinationCache();
		clearDnsBurnedHostCache();
	}
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
