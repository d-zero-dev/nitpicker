import type { Config, InventoryRunMeta, PageSource } from './types.js';
import type { PageData, CrawlerError, Resource } from '../utils/types/types.js';
import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';

import path from 'node:path';

import { ArchiveAccessor } from './archive-accessor.js';
import { acquireArchiveLock } from './archive-lock.js';
import { computeArchiveCacheKey } from './cache/compute-archive-cache-key.js';
import { extractArchiveToCache } from './cache/extract-archive-to-cache.js';
import { getArchiveCacheRoot } from './cache/get-archive-cache-root.js';
import { resolveArchiveCacheDir } from './cache/resolve-archive-cache-dir.js';
import { Database } from './database.js';
import { dbLog, log, saveLog } from './debug.js';
import { appendText } from './filesystem/append-text.js';
import { exists } from './filesystem/exists.js';
import { isDir } from './filesystem/is-dir.js';
import { peekTarTopDir } from './filesystem/peek-tar-top-dir.js';
import { remove } from './filesystem/remove.js';
import { rename } from './filesystem/rename.js';
import { tar } from './filesystem/tar.js';
import { untar } from './filesystem/untar.js';

/**
 * Main archive class for creating, opening, resuming, and writing Nitpicker
 * archive files (`.nitpicker`).
 *
 * An Archive wraps a single SQLite database into a tar archive. HTML
 * bodies live inside the same DB as zstd-compressed BLOBs (see #75) — the
 * tar payload is effectively just `db.sqlite`. It extends
 * {@link ArchiveAccessor} to provide read access to stored data.
 *
 * Use the static factory methods ({@link Archive.create}, {@link Archive.open},
 * {@link Archive.resume}, {@link Archive.connect}) to obtain instances.
 * The constructor is private.
 */
export default class Archive extends ArchiveAccessor {
	/**
	 * Promise tracking an in-progress {@link Archive.close} (or
	 * {@link Archive.releaseHandle}). Acts as the override's idempotency
	 * guard so a second call — e.g. from a signal handler racing the
	 * primary teardown — does not re-enter the destructive prologue
	 * (write/remove) on a half-mutated state.
	 */
	#closeOnce: Promise<void> | null = null;
	/** The SQLite database instance for reading and writing crawl data. */
	#db: Database;
	/** Absolute path to the output `.nitpicker` archive file. */
	#filePath: string;
	/** Lock release function held while the writer owns the archive. */
	#releaseLock: () => Promise<void>;
	/** Absolute path to the temporary working directory containing the SQLite DB. */
	#tmpDir: string;

	/**
	 * The absolute file path of the archive (`.nitpicker` file).
	 */
	get filePath() {
		return this.#filePath;
	}

	/**
	 * The intermediate directory `Archive.write()` produces by renaming
	 * `tmpDir` before tarring (`{cwd}/{archiveName}`). Exposed so the
	 * manager can include it in its cleanup-on-failure path: if `tar()`
	 * fails after the rename, this directory is orphaned and would
	 * otherwise be invisible to a `rmSync(tmpDir)` recovery.
	 */
	get renamedDir(): string {
		return path.resolve(
			path.dirname(this.#filePath),
			path.basename(this.#filePath, path.extname(this.#filePath)),
		);
	}

	// eslint-disable-next-line no-restricted-syntax
	private constructor(
		filePath: string,
		tmpDir: string,
		db: Database,
		releaseLock: () => Promise<void>,
	) {
		super(tmpDir, db, '');
		this.#filePath = filePath;
		this.#tmpDir = tmpDir;
		this.#db = db;
		this.#releaseLock = releaseLock;
		log('create instance: %O', {
			filePath,
			tmpDir,
		});

		this.#db.on('error', (e) => {
			void this.emit('error', e);
		});
	}

	/**
	 * @deprecated This method is no longer functional.
	 */
	abort() {}

	/**
	 * Records a crawler-level error to both the human-readable `error.log` (full
	 * stack, for debugging) and the structured `crawl_errors` table (queryable,
	 * for the `error-kinds` analysis). The cause is not classified here — it is
	 * derived on read. `error.log` keeps the full stack while `crawl_errors`
	 * stores `error.message`; both normally carry the same cause token (e.g.
	 * `ENOTFOUND`), so classification agrees across the two — only an error whose
	 * cause lives solely in deeper stack frames could differ.
	 * @param error - The crawler error object containing process and URL information.
	 */
	async addError(error: CrawlerError) {
		const logFile = path.resolve(this.#tmpDir, 'error.log');
		await appendText(
			logFile,
			`[${error.pid}(${error.isMainProcess ? 'main' : 'sub'})] ${error.url} ${error.error.stack ?? error.error}`,
		);
		await this.#db.insertCrawlError(error.url, error.error.message, error.isExternal);
	}

	/**
	 * Records a partial scrape failure against the page identified by `url`.
	 *
	 * The corresponding `pages` row is created on demand (or matched if it
	 * already exists), so the call works even if the page's normal data has
	 * not been written yet.
	 * @param url - URL of the affected page.
	 * @param phase - Scrape phase name (typically `'retryExhausted'`).
	 * @param message - Human-readable failure message.
	 * @param isExternal - Whether the URL is external. Defaults to `false`.
	 */
	async addPageError(url: string, phase: string, message: string, isExternal = false) {
		dbLog('Add page error: %s [%s]', url, phase);
		await this.#db.insertPageError(url, phase, message, isExternal);
	}
	/**
	 * Retrieves the current crawling state, including lists of scraped and pending URLs.
	 * @returns An object with `scraped` and `pending` URL arrays.
	 */
	async getCrawlingState() {
		return this.#db.getCrawlingState();
	}
	/**
	 * Return the subset of `urls` that already exist as `pages.url`. Used by
	 * `CrawlerOrchestrator.inventory` to filter the user-supplied URL list
	 * down to "URLs that are NOT yet in the archive" — only those reach the
	 * HEAD / scrape pipeline. Existing URLs are skipped to keep the second
	 * (and N-th) `--inventory` pass non-destructive.
	 * @param urls - Candidate URLs in `withoutHashAndAuth` form.
	 * @returns URLs already present in `pages`.
	 */
	async getExistingPageUrls(urls: readonly string[]): Promise<string[]> {
		return this.#db.getExistingPageUrls(urls);
	}
	/**
	 * Return the subset of `urls` that already exist as `resources.url`. See
	 * {@link Archive.getExistingPageUrls} — the resource-side counterpart used
	 * by inventory mode to skip URLs that are already tracked as
	 * sub-resources.
	 * @param urls - Candidate URLs.
	 * @returns URLs already present in `resources`.
	 */
	async getExistingResourceUrls(urls: readonly string[]): Promise<string[]> {
		return this.#db.getExistingResourceUrls(urls);
	}
	/**
	 * Look up the `source` column of a single page row by its URL key. Thin
	 * facade over {@link Database.getPageSourceByUrl} — exposes the lookup
	 * to the orchestrator so it can inject a `PageSourceLookup` into the
	 * Crawler for sub-resource lineage propagation on `--resume` /
	 * `--retry-failed` sessions.
	 * @param url - URL key in `url.withoutHashAndAuth` form.
	 * @returns The recorded `source`, or `undefined` when no row exists.
	 */
	async getPageSourceByUrl(url: string) {
		return this.#db.getPageSourceByUrl(url);
	}
	/**
	 * Retrieves a single recorded sub-resource by its URL.
	 * @param urls - URL candidates to match against the stored resource URL.
	 * @returns The raw resource row, or `null` if none match.
	 */
	async getResourceByUrl(urls: readonly string[]) {
		return this.#db.getResourceByUrl(urls);
	}
	/**
	 * Counts the number of pages already scraped as crawl targets in the archive.
	 *
	 * Lets the crawler initialize its session-progress counter on resume so the
	 * displayed HTML-page count accounts for previously-rendered pages.
	 * @returns The count of pages with `isTarget = 1` and `scraped = 1`.
	 */
	async getScrapedHtmlPageCount() {
		return this.#db.getScrapedHtmlPageCount();
	}
	/**
	 * Retrieves the base URL of the crawl session from the archive database.
	 * @returns The base URL string.
	 */
	async getUrl() {
		return this.#db.getBaseUrl();
	}
	/**
	 * Hostnames whose `crawl_errors` history is consistently DNS failures and
	 * for which no recent 2xx/3xx page or resource is recorded. Consumed by
	 * `CrawlerOrchestrator.#preloadDnsBurnedHostCache` to seed the DNS-burned
	 * host cache at re-open (append / inventory / retryFailed / resume), so
	 * the next crawl skips HEAD pre-flight on hosts the previous crawl
	 * already proved unreachable.
	 *
	 * Deliberately exposed only on `Archive` (writer-side) — read-only
	 * `ArchiveAccessor` (stub viewer) does not see this method so the
	 * stub's no-migration contract is preserved.
	 * @returns Lower-cased hostnames safe to short-circuit.
	 */
	async listDnsBurnedHostCandidates(): Promise<string[]> {
		return this.#db.listDnsBurnedHostCandidates();
	}
	/**
	 * Appends one row to the `inventory_runs` audit log.
	 *
	 * Thin facade over {@link Database.recordInventoryRun} — keeps the
	 * orchestrator decoupled from the knex layer and gives a single
	 * write entry point that future Archive-level concerns (locking,
	 * mirror sync, etc.) can hook into without touching every caller.
	 * @param meta - The run metadata. Only `ran_at` is required.
	 * @returns The autoincremented `id` of the inserted row.
	 */
	async recordInventoryRun(meta: InventoryRunMeta): Promise<number> {
		dbLog('Record inventory run: %s', meta.list_label ?? meta.ran_at);
		return await this.#db.recordInventoryRun(meta);
	}

	/**
	 * Releases the SQLite handle and the advisory lock **without** writing
	 * the archive or removing `tmpDir`.
	 *
	 * Use this when you need to detach from a freshly-created `Archive`
	 * without finalising it — fixtures producing a stub state for tests,
	 * tooling that wants to leave the tmpDir alive for `crawl --resume`,
	 * or any non-orchestrator caller that owns the lifecycle externally.
	 * Shares the same idempotency guard as {@link close}, so the two paths
	 * are mutually exclusive (the first one called wins).
	 */
	async releaseHandle(): Promise<void> {
		if (this.#closeOnce) {
			return this.#closeOnce;
		}
		this.#closeOnce = this.#runReleaseHandle();
		return this.#closeOnce;
	}

	/**
	 * Promote previously-external pages that now fall under the (possibly extended)
	 * scope back to a pending state so that the crawler re-scrapes them as fully
	 * internal pages on the next pass.
	 * @param scopes - Hostname-indexed scope map representing the new scope.
	 * @param options - URL parsing options forwarded to the scope-entry lookup.
	 * @returns The URLs that were repromoted.
	 */
	async repromoteExternalPages(
		scopes: ReadonlyMap<string, readonly ExURL[]>,
		options?: ParseURLOptions,
	) {
		dbLog('Repromote external pages with %d hostnames in scope', scopes.size);
		return this.#db.repromoteExternalPages(scopes, options);
	}
	/**
	 * Reset previously-failed pages back to pending so a follow-up crawl re-fetches them.
	 *
	 * Delegates to {@link Database.resetFailedPages}. See that method for the
	 * exact failure criteria (missing status / content type, or a 5xx status).
	 * @returns The URLs of the pages that were reset to pending.
	 */
	async resetFailedPages() {
		dbLog('Reset failed pages back to pending');
		return this.#db.resetFailedPages();
	}
	/**
	 * Stores the crawl configuration into the archive database.
	 * @param config - The configuration object to store.
	 */
	async setConfig(config: Config) {
		dbLog('Set config: %O', config);
		return this.#db.setConfig(config);
	}
	/**
	 * Stores an external page's data in the archive database without storing
	 * an HTML snapshot. External-page rows carry only metadata (status, title,
	 * content-type), never a rendered body.
	 * @param pageInfo - The page data to store.
	 * @param source - Provenance label for new rows. `undefined` leaves the DB DEFAULT (`'crawled'`).
	 */
	async setExternalPage(pageInfo: PageData, source?: PageSource) {
		dbLog('Set external page: %s', pageInfo.url.href);
		await this.#db.updatePage(pageInfo, false, false, source);
	}
	/**
	 * Stores a crawled page's data in the archive database, persisting the
	 * rendered HTML body as a zstd-compressed BLOB inside the same SQLite
	 * transaction. Storage is content-addressable: identical bodies across
	 * pages share a single `page_html_blobs` row.
	 * @param pageInfo - The page data to store.
	 * @param source - Provenance label for new rows. `undefined` leaves the DB DEFAULT (`'crawled'`).
	 * @returns The database ID of the stored page.
	 */
	async setPage(pageInfo: PageData, source?: PageSource): Promise<number> {
		dbLog('Set page: %s', pageInfo.url.href);
		return await this.#db.updatePage(pageInfo, true, pageInfo.isTarget, source);
	}
	/**
	 * Records a redirect edge without re-storing the destination's content.
	 *
	 * The crawler calls this (instead of {@link setPage}) when a URL redirects to
	 * a destination that has already been rendered (#73): only the source →
	 * destination edge is written, leaving the destination's stored title / meta /
	 * anchors / images untouched.
	 * @param pageInfo - The HEAD-resolved page data carrying the redirect chain.
	 * @param source - Inventory provenance for a brand-new destination row.
	 *   Forwarded to `recordRedirect` so the destination's `source` (and the
	 *   chain-intermediate `source` derived from it) lands on the inventory
	 *   label instead of the DB DEFAULT `'crawled'` when the orchestrator is
	 *   running an inventory pass. `undefined` keeps the DB DEFAULT.
	 */
	async setRedirect(pageInfo: PageData, source?: PageSource) {
		dbLog('Set redirect: %s', pageInfo.url.href);
		await this.#db.recordRedirect(pageInfo, source);
	}
	/**
	 * Stores a sub-resource (CSS, JS, image, etc.) in the archive database.
	 * @param resource - The resource data to store.
	 * @param source - Provenance label for new rows. `undefined` leaves the DB DEFAULT (`'crawled'`).
	 */
	async setResources(resource: Resource, source?: PageSource) {
		dbLog('Set resource: %s', resource.url.href);
		await this.#db.insertResource(resource, source);
	}
	/**
	 * Stores the referrer relationship between a resource and the page that references it.
	 * @param params - An object containing `url` (the page URL) and `src` (the resource URL).
	 * @param params.url
	 * @param params.src
	 */
	async setResourcesReferrers({ url, src }: { url: string; src: string }) {
		dbLog("Set resource's referrers: %s on %s", src, url);
		await this.#db.insertResourceReferrers(src, url);
	}
	/**
	 * Marks a page as skipped in the archive database with the given reason.
	 * @param url - The URL of the page to mark as skipped.
	 * @param reason - The reason the page was skipped.
	 * @param isExternal - Whether the page is on an external domain. Defaults to `false`.
	 */
	async setSkippedPage(url: string, reason: string, isExternal = false) {
		dbLog('Set skipped page: %s', url);
		await this.#db.setSkippedPage(url, reason, isExternal);
	}
	/**
	 * Assigns natural URL sort order values to all pages in the database
	 * that do not yet have an `order` field set.
	 */
	async setUrlOrder() {
		dbLog("Pages didn't have `order` field. So set URL order.");
		await this.#db.setUrlOrder();
	}
	/**
	 * Updates a subset of fields on the archive's `info` row. Used by the append
	 * flow to extend `roots` / `scope` without rewriting the entire config.
	 * @param patch - Partial {@link Config} fields to overwrite. `undefined` values are ignored.
	 */
	async updateConfig(patch: Partial<Config>) {
		dbLog('Update config: %O', patch);
		await this.#db.updateConfig(patch);
	}
	/**
	 * Writes the archive to disk as a `.nitpicker` tar file.
	 *
	 * Checkpoints the SQLite WAL so the database is self-contained inside
	 * `db.sqlite`, renames the temporary working directory to the archive's
	 * basename, and tars it into the final `.nitpicker`. The tar container
	 * holds a single `db.sqlite` file (the legacy `snapshot-html.zip` is gone
	 * — HTML lives as BLOBs in the DB), so finalisation is effectively a
	 * single-file copy with no per-snapshot syscalls.
	 */
	async write() {
		saveLog('Starts: %s', this.#filePath);
		await this.#db.checkpoint();
		const filePathWithoutExt = path.resolve(
			path.dirname(this.#filePath),
			path.basename(this.#filePath, path.extname(this.#filePath)),
		);
		saveLog('Rename temporary dir: %s to %s', this.#tmpDir, filePathWithoutExt);
		await rename(this.#tmpDir, filePathWithoutExt, true);
		saveLog('Tar temporary dir to file: %s to %s', filePathWithoutExt, this.#filePath);
		await tar(filePathWithoutExt, this.#filePath);
		saveLog('Remove temporary dir: %s', filePathWithoutExt);
		await remove(filePathWithoutExt);
		saveLog('Done: %s', this.#filePath);
	}
	/**
	 * Worker for {@link close}. Performs the destructive prologue
	 * (write or remove), drops the DB handle via the base class, then
	 * releases the lock in a `finally` so the lock never leaks even on
	 * partial failure.
	 */
	async #runFullClose(): Promise<void> {
		log('Closing');
		try {
			if (!exists(this.#filePath)) {
				log("Save the file because it doesn't exist");
				await this.write();
			} else if (exists(this.#tmpDir)) {
				log('Remove temporary dir');
				await remove(this.#tmpDir);
			}
			await super.close();
		} finally {
			await this.#releaseLock();
		}
		log('Closing done');
	}
	/**
	 * Worker for {@link releaseHandle}. Drops the SQLite handle and the
	 * advisory lock with no filesystem mutation.
	 */
	async #runReleaseHandle(): Promise<void> {
		log('Releasing handle (no write, no remove)');
		try {
			await super.close();
		} finally {
			await this.#releaseLock();
		}
	}
	/** The file extension for Nitpicker archive files (without the leading dot). */
	static FILE_EXTENSION = 'nitpicker';
	/** The filename of the SQLite database within the archive. */
	static readonly SQLITE_DB_FILE_NAME = 'db.sqlite';
	/** The prefix used for temporary working directories during archive operations. */
	static TMP_DIR_PREFIX = '._nitpicker-';
	/**
	 * Opens a connection to an existing archive's database, defaulting to
	 * read-only.
	 *
	 * Returns an {@link ArchiveAccessor} that provides query methods. In the
	 * default read-only mode, no schema migrations run and the connection
	 * refuses to resurrect a missing parent directory or db file (so a
	 * TOCTOU window between source classification and this call cannot
	 * silently produce an empty phantom tmpDir); the returned accessor is
	 * also marked read-only so consumer-facing helpers (e.g.
	 * {@link ArchiveAccessor.getHtmlOfPage}) avoid any filesystem mutation
	 * on the user's tmpDir.
	 *
	 * `options.readOnly: false` is the narrow escape hatch for issue #112's
	 * on-open viewer read-model build: it opens a second, writable
	 * connection to a `tmpDir` that {@link Archive.openCached} already
	 * extracted (and migrated) into an OS-temp cache directory — never the
	 * caller's live/interrupted crawl tmpDir, which must stay read-only.
	 * Callers opening this way are responsible for their own
	 * cross-process coordination (see `acquireArchiveLock`); this method
	 * does not acquire any lock itself.
	 * @param tmpDir - The path to the temporary directory containing the database.
	 * @param namespace - An optional namespace for scoping data access within the archive.
	 * @param options - Connection options.
	 * @param options.readOnly - Defaults to `true`. Pass `false` to obtain a
	 *   writable accessor against an already-extracted cache directory.
	 * @returns An ArchiveAccessor instance for querying the archive data.
	 * @example
	 * // Default (read-only) — safe for stub mode and cache reads:
	 * const accessor = await Archive.connect(tmpDir);
	 * @example
	 * // Writable escape hatch — only against a tar-cache extraction:
	 * const writable = await Archive.connect(cacheDir, null, { readOnly: false });
	 */
	static async connect(
		tmpDir: string,
		namespace: string | null = null,
		options: { readOnly?: boolean } = {},
	) {
		const readOnly = options.readOnly ?? true;
		const db = await Archive.#connectDB(tmpDir, { readOnly });
		const archive = new ArchiveAccessor(tmpDir, db, namespace, { readOnly });
		return archive;
	}
	/**
	 * Open a `.nitpicker` archive through the read-only tar cache.
	 *
	 * This is the fast path for read-only consumers (viewer, MCP, query
	 * CLI). It diverges from {@link Archive.open} in two important ways:
	 *
	 * 1. The extracted contents land in an OS-temp-scoped cache directory
	 *    keyed by the archive's `size + mtime_ns + ctime_ns` (see
	 *    {@link computeArchiveCacheKey}). Subsequent opens of the same
	 *    unchanged archive skip the untar entirely. A fresh 10 GB archive
	 *    pays the ~10 s untar cost once; reopens are instant.
	 * 2. The returned value is an {@link ArchiveAccessor} (read-only), not
	 *    an `Archive` (writer). Closing it tears down the DB handle but
	 *    leaves the cache directory in place for the next reader. The
	 *    OS's own temp-directory cleanup (macOS reboot, Linux
	 *    `systemd-tmpfiles`, Windows Disk Cleanup) reclaims stale
	 *    entries — we do not own eviction.
	 *
	 * Migrations: the writer-side migration stack
	 * (`initSchema` / `migrate*`) runs once at cache-miss extraction, so
	 * the cache directory always lands on the current schema before the
	 * read-only re-open. Cache hits then skip migrations entirely.
	 *
	 * Override the cache location with `NITPICKER_TAR_CACHE_DIR`. The
	 * disable switch (`NITPICKER_DISABLE_TAR_CACHE=1`) is honoured by
	 * the caller (`ArchiveManager.open` falls back to {@link Archive.open}
	 * in that case); this function itself always goes through the cache.
	 *
	 * Writer entry points (`crawl --append`, `crawl --retry-failed`) must
	 * NOT use this path — they need the lock + write-back semantics of
	 * {@link Archive.open}.
	 * @param filePath - Absolute path to the `.nitpicker` file.
	 * @param namespace - Optional namespace forwarded to {@link ArchiveAccessor}.
	 * @returns A read-only {@link ArchiveAccessor} backed by the cache directory.
	 * @example
	 * ```ts
	 * const accessor = await Archive.openCached('/path/to/site.nitpicker');
	 * try {
	 *   const summary = await getSummary(accessor);
	 * } finally {
	 *   await accessor.close(); // tears down DB handle, cacheDir persists.
	 * }
	 * ```
	 */
	static async openCached(
		filePath: string,
		namespace: string | null = null,
	): Promise<ArchiveAccessor> {
		const cacheRoot = getArchiveCacheRoot();
		const cacheKey = await computeArchiveCacheKey(filePath);
		const cacheDir = resolveArchiveCacheDir(cacheRoot, cacheKey, filePath);
		log('Open cached: %s (cacheDir=%s)', filePath, cacheDir);
		await extractArchiveToCache(filePath, cacheRoot, cacheDir, cacheKey);
		return await Archive.connect(cacheDir, namespace);
	}
	/**
	 * Creates a new archive at the specified file path.
	 * Initializes a temporary working directory and a fresh SQLite database.
	 * @param options - Options including the file path and optional working directory.
	 * @returns A new Archive instance ready for writing crawl data.
	 */
	static async create(options: ArchiveOptions & ParseURLOptions) {
		const { filePath } = options;
		const cwd = options.cwd ?? process.cwd();
		log('Create: %O', {
			filePath,
			cwd,
		});
		const fileName = path.basename(filePath, path.extname(filePath));
		const tmpDir = path.resolve(cwd, Archive.TMP_DIR_PREFIX + fileName);
		const releaseLock = await acquireArchiveLock(tmpDir);
		try {
			return await Archive.#init(filePath, tmpDir, releaseLock);
		} catch (error) {
			await releaseLock();
			throw error;
		}
	}
	/**
	 * Joins path segments into an absolute path.
	 * @param pathes - The path segments to join.
	 * @returns The resolved absolute path.
	 */
	static joinPath(...pathes: string[]) {
		return path.resolve(...pathes);
	}
	/**
	 * Opens an existing archive file (`.nitpicker`) by extracting it to a temporary directory.
	 * @param options - Options including the file path, optional working directory,
	 *                  and whether to extract plugin data.
	 * @returns An Archive instance with the extracted data loaded.
	 */
	static async open(options: ArchiveOptions & ArchiveOpenOptions) {
		const { filePath, openPluginData } = options;
		const cwd = options.cwd ?? process.cwd();
		log('Open: %O', {
			filePath,
			cwd,
			openPluginData,
		});
		// Read the tar's actual top-level directory name instead of deriving
		// it from the outer file's basename. `.nitpicker` files are plain
		// tar archives and users routinely rename them (`mv X.nitpicker
		// Y.nitpicker`) — that operation must not break `open`. The inner
		// directory keeps whatever name `Archive.write()` baked in at write
		// time, and `tmpDir` mirrors the OUTER basename (so concurrent
		// crawls on differently-named copies of the same archive don't
		// collide on the lockfile).
		const outerBasename = path.basename(filePath, path.extname(filePath));
		const innerDirName = await peekTarTopDir(filePath);
		const tmpDir = path.resolve(cwd, Archive.TMP_DIR_PREFIX + outerBasename);
		const releaseLock = await acquireArchiveLock(tmpDir);
		try {
			const openFiles: string[] = [];
			if (!openPluginData) {
				const relDdPath = path.join(innerDirName, Archive.SQLITE_DB_FILE_NAME);
				openFiles.push(relDdPath);
			}
			log('Unzip file: %s (%O)', filePath, openFiles);
			await untar(filePath, {
				cwd,
				fileList: openFiles.length > 0 ? openFiles : undefined,
			});
			const extractedDir = path.resolve(cwd, innerDirName);
			log('Move directory: %s to %s', extractedDir, tmpDir);
			await rename(extractedDir, tmpDir, true);
			return await Archive.#init(filePath, tmpDir, releaseLock);
		} catch (error) {
			await releaseLock();
			throw error;
		}
	}
	/**
	 * Resumes an archive from an existing temporary directory
	 * (e.g., after an interrupted crawl session).
	 * @param targetPath - The path to the temporary directory to resume from.
	 * @returns An Archive instance reconnected to the existing data.
	 * @throws {Error} If the specified path is not a directory.
	 */
	static async resume(targetPath: string) {
		log('Resume: %s', targetPath);
		if (await isDir(targetPath)) {
			const tmpDir = targetPath;
			const releaseLock = await acquireArchiveLock(tmpDir);
			try {
				const db = await Archive.#connectDB(tmpDir);
				const name =
					(await db.getName()) ||
					path.basename(targetPath).replace(Archive.TMP_DIR_PREFIX, '');
				const filePath = path.resolve(process.cwd(), name + '.' + Archive.FILE_EXTENSION);
				return new Archive(filePath, tmpDir, db, releaseLock);
			} catch (error) {
				await releaseLock();
				throw error;
			}
		}
		throw new Error(
			'The specified path is not a directory. Please ensure the path points to a valid directory.',
		);
	}
	/**
	 * Generates a timestamp string in the format `YYYYMMDDHHmmssSSS`
	 * suitable for use in file names.
	 * @returns A formatted timestamp string.
	 */
	static timestamp() {
		const now = new Date();
		const year = now.getFullYear().toString();
		const month = (now.getMonth() + 1).toLocaleString('en-US', {
			minimumIntegerDigits: 2,
		});
		const date = now.getDate().toLocaleString('en-US', { minimumIntegerDigits: 2 });
		const hours = now.getHours().toLocaleString('en-US', { minimumIntegerDigits: 2 });
		const minutes = now.getMinutes().toLocaleString('en-US', { minimumIntegerDigits: 2 });
		const seconds = now.getSeconds().toLocaleString('en-US', { minimumIntegerDigits: 2 });
		const ms = now.getMilliseconds().toLocaleString('en-US', { minimumIntegerDigits: 3 });
		return year + month + date + hours + minutes + seconds + ms;
	}
	/**
	 * Connects to (or creates) the SQLite database in the given directory.
	 * @param tmpDir - Directory containing `db.sqlite`
	 * @param options - Optional connection flags forwarded to
	 *   {@link Database.connect}. Used by {@link Archive.connect} to pass
	 *   `readOnly: true` so no migrations run and a missing tmpDir is not
	 *   resurrected.
	 * @param options.readOnly
	 */
	static async #connectDB(tmpDir: string, options?: { readOnly?: boolean }) {
		const dbPath = path.resolve(tmpDir, Archive.SQLITE_DB_FILE_NAME);
		dbLog('connects database: %s (readOnly=%s)', dbPath, options?.readOnly ?? false);
		return await Database.connect({
			filename: dbPath,
			readOnly: options?.readOnly,
		});
	}
	/**
	 * Initializes an Archive instance by connecting to the database.
	 *
	 * The advisory lock must already be acquired by the caller; this helper just
	 * threads the release function through to the resulting `Archive` so that
	 * {@link Archive.close} can drop the lock when work is done.
	 * @param filePath - Output `.nitpicker` file path
	 * @param tmpDir - Temporary working directory path
	 * @param releaseLock - Function returned by {@link acquireArchiveLock}.
	 */
	static async #init(filePath: string, tmpDir: string, releaseLock: () => Promise<void>) {
		const db = await Archive.#connectDB(tmpDir);
		const archive = new Archive(filePath, tmpDir, db, releaseLock);
		return archive;
	}
	/**
	 * Closes the archive. If the archive file does not yet exist on disk,
	 * it writes the archive first. If the temporary directory still exists,
	 * it is removed. The database connection is then closed via
	 * {@link ArchiveAccessor.close} (the base class owns the SQLite handle),
	 * and finally the archive's advisory lock is released.
	 *
	 * **Idempotent**: the first invocation captures the close promise;
	 * subsequent invocations (signal handlers, parallel teardowns, retried
	 * orchestrator paths) await the same promise instead of re-entering
	 * the destructive prologue on a half-mutated state. If the first
	 * close fails (e.g. ENOSPC during tar), the rejection propagates to
	 * all awaiters and the archive stays latched closed — there is no
	 * safe way to retry `write()` once `tmpDir` has been renamed.
	 *
	 * **Read-only consumers must not reach this override.** Anything that
	 * obtains an archive view via {@link Archive.connect} receives an
	 * {@link ArchiveAccessor} (not an `Archive`), so `close()` resolves to
	 * the safe base implementation — no `write()`, no `remove()`, no lock
	 * release — leaving the tmpDir intact for the live crawler.
	 */
	override async close(): Promise<void> {
		if (this.#closeOnce) {
			return this.#closeOnce;
		}
		this.#closeOnce = this.#runFullClose();
		return this.#closeOnce;
	}

	/**
	 * Retrieves the crawl configuration stored in the archive database.
	 * @returns The configuration object.
	 */
	override async getConfig() {
		return this.#db.getConfig();
	}
}

/**
 * Options for creating or opening an archive.
 */
type ArchiveOptions = {
	/** The file path for the archive (`.nitpicker` file). */
	filePath: string;
	/** The working directory. Defaults to `process.cwd()`. */
	cwd?: string;
};

/**
 * Additional options for opening an existing archive.
 */
type ArchiveOpenOptions = {
	/** When true, extracts all files including plugin data. When false, only extracts the database and snapshots. */
	openPluginData?: boolean;
};
