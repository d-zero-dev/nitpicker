import type { Config } from './types.js';
import type { PageData, CrawlerError, Resource } from '../utils/index.js';
import type { ParseURLOptions } from '@d-zero/shared/parse-url';

import path from 'node:path';

import { ArchiveAccessor } from './archive-accessor.js';
import { Database } from './database.js';
import { dbLog, log, saveLog } from './debug.js';
import {
	appendText,
	exists,
	isDir,
	outputText,
	remove,
	rename,
	tar,
	untar,
	zip,
} from './filesystem/index.js';

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
	/** The SQLite database instance for reading and writing crawl data. */
	#db: Database;
	/** Absolute path to the output `.nitpicker` archive file. */
	#filePath: string;
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

	// eslint-disable-next-line no-restricted-syntax
	private constructor(filePath: string, tmpDir: string, db: Database) {
		super(tmpDir, db, '');
		this.#filePath = filePath;
		this.#tmpDir = tmpDir;
		this.#snapshotDir = path.resolve(this.#tmpDir, Archive.SNAPSHOT_HTML_DIR);
		this.#db = db;
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
	 * Closes the archive. If the archive file does not yet exist on disk,
	 * it writes the archive first. If the temporary directory still exists,
	 * it is removed.
	 */
	async close() {
		log('Closing');
		if (!exists(this.#filePath)) {
			log("Save the file because it doesn't exist");
			await this.write();
		} else if (exists(this.#tmpDir)) {
			log('Remove temporary dir');
			await remove(this.#tmpDir);
		}
		await this.#db.destroy();
		log('Closing done');
	}

	/**
	 * Retrieves the current crawling state, including lists of scraped and pending URLs.
	 * @returns An object with `scraped` and `pending` URL arrays.
	 */
	async getCrawlingState() {
		return this.#db.getCrawlingState();
	}
	/**
	 * Retrieves the base URL of the crawl session from the archive database.
	 * @returns The base URL string.
	 */
	async getUrl() {
		return this.#db.getBaseUrl();
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
	 * @param pageInfo - The page data to store.
	 * @returns The database ID of the stored page.
	 */
	async setPage(pageInfo: PageData): Promise<number> {
		dbLog('Set page: %s', pageInfo.url.href);
		const { html, pageId } = await this.#db.updatePage(
			pageInfo,
			this.#snapshotDir,
			pageInfo.isTarget,
		);
		const snapshotTask: Promise<void>[] = [];
		if (html) {
			snapshotTask.push(outputText(html, pageInfo.html));
		}

		await Promise.all(snapshotTask);

		return pageId;
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
	 * Writes the archive to disk as a compressed `.nitpicker` file.
	 *
	 * This method compresses the HTML snapshot directory into a zip file,
	 * renames the temporary working directory, and creates the final tar archive.
	 * The temporary directory is removed after writing.
	 */
	async write() {
		saveLog('Starts: %s', this.#filePath);
		const snapshotZip = `${this.#snapshotDir}.zip`;
		if (exists(this.#snapshotDir)) {
			if (!exists(snapshotZip)) {
				saveLog('Zips snapshot dir: %s', this.#snapshotDir);
				await zip(snapshotZip, this.#snapshotDir);
			}
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
	 * Returns an {@link ArchiveAccessor} that provides query methods
	 * without the ability to modify or write the archive.
	 * @param tmpDir - The path to the temporary directory containing the database.
	 * @param namespace - An optional namespace for scoping data access within the archive.
	 * @returns An ArchiveAccessor instance for querying the archive data.
	 */
	static async connect(tmpDir: string, namespace: string | null = null) {
		const db = await Archive.#connectDB(tmpDir);
		const archive = new ArchiveAccessor(tmpDir, db, namespace);
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
		return await Archive.#init(filePath, tmpDir);
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
		return await Archive.#init(filePath, tmpDir);
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
			const db = await Archive.#connectDB(tmpDir);
			const name =
				(await db.getName()) ||
				path.basename(targetPath).replace(Archive.TMP_DIR_PREFIX, '');
			const filePath = path.resolve(process.cwd(), name + '.' + Archive.FILE_EXTENSION);
			return await Archive.#init(filePath, tmpDir);
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
	 */
	static async #connectDB(tmpDir: string) {
		const dbPath = path.resolve(tmpDir, Archive.SQLITE_DB_FILE_NAME);
		dbLog('connects database: %s', dbPath);
		return await Database.connect({
			type: 'sqlite3',
			workingDir: tmpDir,
			filename: dbPath,
		});
	}
	/**
	 * Initializes an Archive instance by connecting to the database.
	 * @param filePath - Output `.nitpicker` file path
	 * @param tmpDir - Temporary working directory path
	 */
	static async #init(filePath: string, tmpDir: string) {
		const db = await Archive.#connectDB(tmpDir);
		const archive = new Archive(filePath, tmpDir, db);
		return archive;
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
