import type { Config } from './archive/types.js';
import type { CrawlEvent } from './types.js';
import type { ExURL } from '@d-zero/shared/parse-url';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { sortUrl } from '@d-zero/shared/sort-url';
import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';

import pkg from '../package.json' with { type: 'json' };

import Archive from './archive/archive.js';
import { clearDestinationCache, Crawler } from './crawler/index.js';
import { crawlerLog, log } from './debug.js';
import { resolveOutputPath } from './resolve-output-path.js';
import { cleanObject } from './utils/index.js';

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
			scope: options?.scope ?? [],
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
		});
	}

	/**
	 * Abort the current crawl and archive operations.
	 *
	 * Delegates to the archive's abort method, which stops all in-progress
	 * database writes and cleans up temporary resources.
	 * @returns The result of the archive abort operation.
	 */
	abort() {
		return this.#archive.abort();
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

		return new Promise<void>((resolve, reject) => {
			this.#crawler.on('error', (error) => {
				crawlerLog('On error: %O', error);
				void this.#archive.addError(error);
				void this.emit('error', error);
			});

			this.#crawler.on('page', async ({ result }) => {
				await this.#archive.setPage(result).catch((error) => reject(error));
			});

			this.#crawler.on('externalPage', ({ result }) => {
				this.#archive.setExternalPage(result).catch((error) => reject(error));
			});

			this.#crawler.on('skip', ({ url, reason, isExternal }) => {
				this.#archive
					.setSkippedPage(url, reason, isExternal)
					.catch((error) => reject(error));
			});

			this.#crawler.on('response', ({ resource }) => {
				this.#archive.setResources(resource).catch((error) => reject(error));
			});

			this.#crawler.on('responseReferrers', (resource) => {
				this.#archive.setResourcesReferrers(resource).catch((error) => reject(error));
			});

			this.#crawler.on('crawlEnd', () => {
				resolve();
			});

			if (this.#fromList) {
				this.#crawler.startMultiple(list);
			} else {
				this.#crawler.start(root);
			}
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
		const fileName = options?.filePath
			? path.basename(options.filePath, `.${Archive.FILE_EXTENSION}`)
			: `${urlParsed.hostname}-${Archive.timestamp()}`;
		const filePath = options?.filePath
			? resolveOutputPath(options.filePath, cwd)
			: Archive.joinPath(cwd, `${fileName}.${Archive.FILE_EXTENSION}`);
		const disableQueries = options?.disableQueries || false;
		const defaultUserAgent = `Nitpicker/${pkg.version}`;
		const archive = await Archive.create({ filePath, cwd, disableQueries });
		await archive.setConfig({
			version: pkg.version,
			name: fileName,
			baseUrl: urlParsed.withoutHash,
			recursive: options?.recursive ?? true,
			fetchExternal: options?.fetchExternal ?? true,
			image: options?.image ?? true,
			interval: options?.interval || 0,
			parallels: options?.parallels || 0,
			scope: options?.scope ?? [],
			// @ts-expect-error TODO: Fix CLI arguments
			excludes: normalizeToArray(options?.exclude),
			// @ts-expect-error TODO: Fix CLI arguments
			excludeKeywords: normalizeToArray(options?.excludeKeyword),
			excludeUrls: [
				...DEFAULT_EXCLUDED_EXTERNAL_URLS,
				// @ts-expect-error TODO: Fix CLI arguments
				...normalizeToArray(options?.excludeUrl),
			],
			maxExcludedDepth: options?.maxExcludedDepth || 10,
			retry: options?.retry ?? 3,
			fromList: !!options?.list,
			disableQueries,
			userAgent: options?.userAgent || defaultUserAgent,
			ignoreRobots: options?.ignoreRobots ?? false,
		});
		const orchestrator = new CrawlerOrchestrator(archive, options);
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
		orchestrator.#crawler.resume(pending, scraped, resources);
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
 * Normalize an optional parameter that may be a single value, an array,
 * null, or undefined into a guaranteed array.
 * @param param - The parameter to normalize.
 * @returns An array containing the parameter value(s), or an empty array if absent.
 */
function normalizeToArray<T>(param: T | T[] | null | undefined) {
	return Array.isArray(param) ? param : param ? [param] : [];
}
