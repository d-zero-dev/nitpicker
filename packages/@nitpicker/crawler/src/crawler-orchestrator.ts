import type { Config } from './archive/types.js';
import type { CrawlEvent } from './types.js';
import type { ExURL } from '@d-zero/shared/parse-url';

import { copyFile, unlink as unlinkFile } from 'node:fs/promises';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { sortUrl } from '@d-zero/shared/sort-url';
import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';

import pkg from '../package.json' with { type: 'json' };

import Archive from './archive/archive.js';
import { clearDestinationCache } from './crawler/clear-destination-cache.js';
import Crawler from './crawler/crawler.js';
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
	 * @param list - The list of parsed URLs to crawl. The first URL is used as the root.
	 * @returns A promise that resolves when crawling is complete.
	 * @throws {Error} If the URL list is empty.
	 */
	async crawling(list: ExURL[]) {
		const root = list[0];

		if (!root) {
			throw new Error('URL is empty');
		}

		const writeQueue = this.#writeQueue;

		return new Promise<void>((resolve, reject) => {
			this.#crawler.on('error', (error) => {
				crawlerLog('On error: %O', error);
				writeQueue
					.enqueue(() => this.#archive.addError(error))
					.catch((writeError) => reject(writeError));
				void this.emit('error', error);
			});

			this.#crawler.on('page', ({ result }) => {
				writeQueue
					.enqueue(() => this.#archive.setPage(result))
					.catch((error) => reject(error));
			});

			this.#crawler.on('externalPage', ({ result }) => {
				writeQueue
					.enqueue(() => this.#archive.setExternalPage(result))
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

			this.#crawler.on('redirect', ({ result }) => {
				writeQueue
					.enqueue(() => this.#archive.setRedirect(result))
					.catch((error) => reject(error));
				void this.emit('redirect', { result });
			});

			this.#crawler.on('response', ({ resource }) => {
				writeQueue
					.enqueue(() => this.#archive.setResources(resource))
					.catch((error) => reject(error));
			});

			this.#crawler.on('responseReferrers', (resource) => {
				writeQueue
					.enqueue(() => this.#archive.setResourcesReferrers(resource))
					.catch((error) => reject(error));
			});

			this.#crawler.on('crawlEnd', () => {
				writeQueue
					.drain()
					.then(() => resolve())
					.catch((error) => reject(error));
			});

			this.#crawler.start(list, { recursive: !this.#fromList });
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
			version: pkg.version,
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
		clearDestinationCache();
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

		const archive = await Archive.open({ filePath: absFilePath, cwd });
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
				await orchestrator.crawling(newParsed);
				clearDestinationCache();
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
		await orchestrator.crawling([url]);
		return orchestrator;
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
