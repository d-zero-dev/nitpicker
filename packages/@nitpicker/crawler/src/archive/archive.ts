import type { Config } from './types.js';
import type { PageData, CrawlerError, Resource } from '../utils/types/types.js';
import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';

import path from 'node:path';

import { zip } from '@d-zero/fs/zip';

import { ArchiveAccessor } from './archive-accessor.js';
import { acquireArchiveLock } from './archive-lock.js';
import { Database } from './database.js';
import { dbLog, log, saveLog } from './debug.js';
import { appendText } from './filesystem/append-text.js';
import { exists } from './filesystem/exists.js';
import { extractMissingZipEntries } from './filesystem/extract-missing-zip-entries.js';
import { isDir } from './filesystem/is-dir.js';
import { outputText } from './filesystem/output-text.js';
import { remove } from './filesystem/remove.js';
import { rename } from './filesystem/rename.js';
import { tar } from './filesystem/tar.js';
import { untar } from './filesystem/untar.js';

/**
 * Main archive class for creating, opening, resuming, and writing Nitpicker archive files (`.nitpicker`).
 *
 * An Archive wraps a SQLite database and optional HTML snapshots into a compressed
 * tar archive. It extends {@link ArchiveAccessor} to provide read access to stored data.
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
	/** Absolute path to the HTML snapshot directory within the temporary working directory. */
	#snapshotDir: string;
	/** Absolute path to the temporary working directory containing the SQLite DB and snapshots. */
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
		this.#snapshotDir = path.resolve(this.#tmpDir, Archive.SNAPSHOT_HTML_DIR);
		this.#db = db;
		this.#releaseLock = releaseLock;
		log('create instance: %O', {
			filePath,
			tmpDir,
			snapshotDir: this.#snapshotDir,
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
	 * Appends an error entry to the archive's error log file.
	 * @param error - The crawler error object containing process and URL information.
	 */
	async addError(error: CrawlerError) {
		const logFile = path.resolve(this.#tmpDir, 'error.log');
		await appendText(
			logFile,
			`[${error.pid}(${error.isMainProcess ? 'main' : 'sub'})] ${error.url} ${error.error.stack ?? error.error}`,
		);
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
	 * Stores the crawl configuration into the archive database.
	 * @param config - The configuration object to store.
	 */
	async setConfig(config: Config) {
		dbLog('Set config: %O', config);
		return this.#db.setConfig(config);
	}
	/**
	 * Stores an external page's data in the archive database without saving a snapshot.
	 * @param pageInfo - The page data to store.
	 */
	async setExternalPage(pageInfo: PageData) {
		dbLog('Set external page: %s', pageInfo.url.href);
		await this.#db.updatePage(pageInfo, null, false);
	}
	/**
	 * Stores a crawled page's data in the archive database and optionally saves an HTML snapshot.
	 * If the snapshot file write fails, the HTML path in the database is cleared to prevent
	 * referencing a non-existent file, and the error is re-thrown.
	 * @param pageInfo - The page data to store.
	 * @returns The database ID of the stored page.
	 * @throws {Error} Re-throws any error from the snapshot file write after clearing the HTML path.
	 */
	async setPage(pageInfo: PageData): Promise<number> {
		dbLog('Set page: %s', pageInfo.url.href);
		const { html, pageId } = await this.#db.updatePage(
			pageInfo,
			this.#snapshotDir,
			pageInfo.isTarget,
		);
		if (html) {
			try {
				await outputText(html, pageInfo.html);
			} catch (error) {
				dbLog('Snapshot write failed for page %d, clearing html path: %s', pageId, html);
				try {
					await this.#db.clearHtmlPath(pageId);
				} catch (clearError) {
					dbLog('Failed to clear html path for page %d: %s', pageId, clearError);
				}
				throw error;
			}
		}

		return pageId;
	}
	/**
	 * Records a redirect edge without re-storing the destination's content.
	 *
	 * The crawler calls this (instead of {@link setPage}) when a URL redirects to
	 * a destination that has already been rendered (#73): only the source →
	 * destination edge is written, leaving the destination's stored title / meta /
	 * anchors / images untouched.
	 * @param pageInfo - The HEAD-resolved page data carrying the redirect chain.
	 */
	async setRedirect(pageInfo: PageData) {
		dbLog('Set redirect: %s', pageInfo.url.href);
		await this.#db.recordRedirect(pageInfo);
	}
	/**
	 * Stores a sub-resource (CSS, JS, image, etc.) in the archive database.
	 * @param resource - The resource data to store.
	 */
	async setResources(resource: Resource) {
		dbLog('Set resource: %s', resource.url.href);
		await this.#db.insertResource(resource);
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
	 * Writes the archive to disk as a compressed `.nitpicker` file.
	 *
	 * This method compresses the HTML snapshot directory into a zip file,
	 * renames the temporary working directory, and creates the final tar archive.
	 * The temporary directory is removed after writing.
	 */
	async write() {
		saveLog('Starts: %s', this.#filePath);
		// The cached snapshot zip central directories become dangling once the
		// zip is rewritten or tmpDir is renamed below.
		this.invalidateSnapshotZipCache();
		const snapshotZip = `${this.#snapshotDir}.zip`;
		if (exists(this.#snapshotDir)) {
			if (exists(snapshotZip)) {
				// Append flow: the dir holds only the snapshots written during this
				// session while the zip holds the pre-existing ones. Merge the zip's
				// entries into the dir (existing files win) and re-zip, so appended
				// snapshots are not lost.
				saveLog('Merges zipped snapshots into snapshot dir: %s', this.#snapshotDir);
				await extractMissingZipEntries(snapshotZip, this.#snapshotDir);
				await remove(snapshotZip);
			}
			saveLog('Zips snapshot dir: %s', this.#snapshotDir);
			await zip(snapshotZip, this.#snapshotDir);
			saveLog('Remove snapshot dir: %s', this.#snapshotDir);
			await remove(this.#snapshotDir);
		}
		await this.#db.checkpoint();
		const filePathWithoutExt = path.resolve(
			path.dirname(this.#filePath),
			path.basename(this.#filePath, path.extname(this.#filePath)),
		);
		saveLog('Rename temporary dir: %s to %s', this.#tmpDir, filePathWithoutExt);
		await rename(this.#tmpDir, filePathWithoutExt, true);
		saveLog('Zip temporary dir to file: %s to %s', filePathWithoutExt, this.#filePath);
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
	/** The directory name used for storing HTML snapshots within the archive. */
	static readonly SNAPSHOT_HTML_DIR = 'snapshot-html';
	/** The filename of the SQLite database within the archive. */
	static readonly SQLITE_DB_FILE_NAME = 'db.sqlite';
	/** The prefix used for temporary working directories during archive operations. */
	static TMP_DIR_PREFIX = '._nitpicker-';
	/**
	 * Opens a read-only connection to an existing archive's database.
	 *
	 * Returns an {@link ArchiveAccessor} that provides query methods
	 * without the ability to modify or write the archive. The DB is opened
	 * in **read-only mode**: no schema migrations run, and the connection
	 * refuses to resurrect a missing parent directory or db file (so a
	 * TOCTOU window between source classification and this call cannot
	 * silently produce an empty phantom tmpDir).
	 *
	 * The returned accessor is also marked read-only so consumer-facing
	 * helpers (e.g. {@link ArchiveAccessor.getHtmlOfPage}) avoid any
	 * filesystem mutation on the user's tmpDir.
	 * @param tmpDir - The path to the temporary directory containing the database.
	 * @param namespace - An optional namespace for scoping data access within the archive.
	 * @returns An ArchiveAccessor instance for querying the archive data.
	 */
	static async connect(tmpDir: string, namespace: string | null = null) {
		const db = await Archive.#connectDB(tmpDir, { readOnly: true });
		const archive = new ArchiveAccessor(tmpDir, db, namespace, { readOnly: true });
		return archive;
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
		const fileName = path.basename(filePath, path.extname(filePath));
		const tmpDir = path.resolve(cwd, Archive.TMP_DIR_PREFIX + fileName);
		const releaseLock = await acquireArchiveLock(tmpDir);
		try {
			const openFiles: string[] = [];
			if (!openPluginData) {
				const relDdPath = path.join(fileName, Archive.SQLITE_DB_FILE_NAME);
				const relSnapshotPath = path.join(fileName, Archive.SNAPSHOT_HTML_DIR + '.zip');
				openFiles.push(relDdPath, relSnapshotPath);
			}
			log('Unzip file: %s (%O)', filePath, openFiles);
			await untar(filePath, {
				cwd,
				fileList: openFiles.length > 0 ? openFiles : undefined,
			});
			const extractedDir = path.resolve(cwd, fileName);
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
			workingDir: tmpDir,
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
