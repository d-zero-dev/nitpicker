import type { Database } from './database.js';
import type {
	Config,
	DB_Anchor,
	DB_Redirect,
	DB_Referrer,
	DatabaseEvent,
	PageFilter,
} from './types.js';
import type { ParseURLOptions } from '@d-zero/shared/parse-url';

import path from 'node:path';

import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';

import { log } from './debug.js';
import {
	exists,
	extractZip,
	outputJSON,
	outputText,
	readJSON,
	readText,
	unzip,
} from './filesystem/index.js';
import Page from './page.js';
import Resource from './resource.js';
import { safePath } from './safe-path.js';

/**
 * Provides read-only access to an archive's database and stored data files.
 *
 * This class is the base for the `Archive` class and is also returned
 * by `Archive.connect` for read-only access to an existing archive.
 * It supports querying pages, anchors, referrers, resources, and custom data.
 */
export class ArchiveAccessor extends EventEmitter<DatabaseEvent> {
	/** The SQLite database instance for querying archived data. */
	#db: Database;
	/** Namespace prefix for custom data storage (e.g. `"analysis/plugin-name"`). `null` disables `setData`. */
	#namespace: string | null = null;
	/** Absolute path to the temporary working directory containing the database and files. */
	#tmpDir: string;

	/**
	 * The absolute path to the temporary working directory used by this accessor.
	 */
	get tmpDir() {
		return this.#tmpDir;
	}

	/**
	 * Creates a new ArchiveAccessor instance.
	 * @param tmpDir - The path to the temporary directory containing the archive data.
	 * @param db - The Database instance for querying the SQLite database.
	 * @param namespace - An optional namespace for scoping custom data storage.
	 *                    When null, `setData` is not available.
	 */
	constructor(tmpDir: string, db: Database, namespace: string | null = null) {
		super();
		this.#tmpDir = tmpDir;
		this.#db = db;
		this.#namespace = namespace;

		this.#db.on('error', (e) => {
			void this.emit('error', e);
		});
	}

	/**
	 * Retrieves the crawl configuration stored in the archive database.
	 * @returns The parsed {@link Config} object.
	 */
	async getConfig(): Promise<Config> {
		return this.#db.getConfig();
	}

	/**
	 * Retrieves anchor (link) data for a specific page by its database ID.
	 * @param pageId - The database ID of the page whose anchors to retrieve.
	 * @returns An array of anchor records found on the page.
	 */
	async getAnchorsOnPage(pageId: number) {
		const refs = await this.#db.getAnchorsOnPage(pageId);
		return refs;
	}

	/**
	 * Reads custom data stored in the archive by name.
	 * @param name - The base name of the data file (without extension).
	 * @param format - The file format: `'json'` (default), `'txt'`, or `'html'`.
	 * @returns The parsed JSON object for `'json'` format, or a string for `'txt'`/`'html'` format.
	 */
	async getData<T>(name: string, format?: 'json'): Promise<T>;
	/**
	 * Reads custom data stored in the archive by name as a string.
	 * @param name - The base name of the data file (without extension).
	 * @param format - The file format: `'txt'` or `'html'`.
	 * @returns The file contents as a string.
	 */
	async getData(name: string, format?: 'txt' | 'html'): Promise<string>;
	async getData<T>(name: string, format: 'json' | 'txt' | 'html' = 'json') {
		const namespace = this.#namespace || '';
		const filePath = safePath(this.#tmpDir, namespace, `${name}.${format}`);
		if (format === 'json') {
			return await readJSON<T>(filePath);
		}
		return await readText(filePath);
	}

	/**
	 * Reads the HTML content of a page snapshot from the archive.
	 * Supports reading from both unzipped directories and zipped snapshot archives.
	 * @param filePath - The relative file path to the HTML snapshot, or null.
	 * @param openZipped - Whether to attempt unzipping the snapshot archive. Defaults to `true`.
	 * @returns The HTML content as a string, or null if the snapshot is not found or filePath is null.
	 */
	async getHtmlOfPage(filePath: string | null, openZipped = true) {
		if (!filePath) {
			return null;
		}
		const snapshotDir = safePath(this.#tmpDir, path.dirname(filePath));
		const name = path.basename(filePath);

		if (openZipped) {
			await unzip(`${snapshotDir}.zip`, snapshotDir);
		}

		if (exists(snapshotDir)) {
			log('Load %s directly because snapshot dir is unzipped', name);
			const html = await readText(path.resolve(snapshotDir, name)).catch(
				(error) => error,
			);
			if (typeof html === 'string') {
				log('Loaded: %s ...', html.split('\n')[0]);
				return html;
			}
			log('Failed Loading: %O', html);
			return null;
		}
		log('Extracts %s from zipped snapshots', name);
		const zipDir = await extractZip(`${snapshotDir}.zip`);
		const file = zipDir.files.find((f) => f.type === 'File' && f.path === name);
		if (!file) {
			log('Failed: Not found %s from zipped snapshots', name);
			return null;
		}
		const buffer = await file.buffer();
		const html = buffer.toString('utf8') || null;
		log('Succeeded: Extracts %s from zipped snapshots', name);
		return html;
	}

	/**
	 * Retrieves all pages from the archive, optionally filtered by type.
	 * Eagerly loads redirect relationships (`redirectFrom`) but does NOT load
	 * anchor or referrer relationships.
	 * Use {@link getPagesWithRefs} if you need those relationships.
	 * @param filter - An optional filter to narrow the results (e.g., `'internal-page'`, `'external-page'`).
	 * @returns An array of {@link Page} instances.
	 */
	async getPages(filter?: PageFilter) {
		const pages = await this.#db.getPages(filter);
		if (pages.length === 0) return [];

		const pageIds = pages.map((p) => p.id);
		const redirects = await this.#db.getRedirectsForPages(pageIds);

		const redirectMap = new Map<number, DB_Redirect[]>();
		for (const redirect of redirects) {
			const current = redirectMap.get(redirect.pageId);
			if (current) {
				current.push(redirect);
				continue;
			}
			redirectMap.set(redirect.pageId, [redirect]);
		}

		return pages.map((page) => new Page(this, page, redirectMap.get(page.id) || []));
	}

	/**
	 * Retrieves pages with their related data (redirects, anchors, referrers) in batches.
	 * Processes pages in chunks of `limit` size, calling the callback for each batch.
	 * @param limit - The maximum number of pages to load per batch.
	 * @param callback - A function called for each batch of pages with the current offset and total count.
	 * @param options - Optional URL parsing options and whether to include referrer relationships.
	 */
	async getPagesWithRefs(
		limit: number,
		callback: (pages: Page[], currentOffset: number, max: number) => void | Promise<void>,
		options?: ParseURLOptions & {
			withRefs?: boolean;
		},
	) {
		const max = await this.#getPageCount();
		let times = 0;

		while (true) {
			const offset = times * limit;
			log('%d times loop: %o', times, {
				offset,
				limit,
				max,
			});
			const pages = await this.#getPagesWithRels(offset, limit, options);
			if (pages.length === 0) {
				break;
			}
			await callback(pages, offset, max);
			times++;
		}
	}

	/**
	 * Retrieves pages that link to the specified page (incoming links).
	 * @param pageId - The database ID of the target page.
	 * @returns An array of referrer records.
	 */
	async getReferrersOfPage(pageId: number) {
		const refs = await this.#db.getReferrersOfPage(pageId);
		return refs;
	}

	/**
	 * Retrieves page URLs that reference the specified resource.
	 * @param pageId - The database ID of the resource.
	 * @returns An array of page URL strings that reference this resource.
	 */
	async getReferrersOfResource(pageId: number) {
		const refs = await this.#db.getReferrersOfResource(pageId);
		return refs;
	}

	/**
	 * Retrieves all sub-resources (CSS, JS, images, etc.) stored in the archive.
	 * @returns An array of {@link Resource} instances.
	 */
	async getResources() {
		const resources = await this.#db.getResources();
		return resources.map((r) => new Resource(this, r));
	}

	/**
	 * Retrieves a flat list of all resource URLs stored in the archive.
	 * @returns An array of resource URL strings.
	 */
	async getResourceUrlList() {
		return this.#db.getResourceUrlList();
	}

	/**
	 * Stores custom data in the archive under the configured namespace.
	 * Requires a namespace to be set on this accessor; throws if namespace is null.
	 * @param name - The base name of the data file (without extension).
	 * @param data - The data to store. For JSON format, this will be serialized. For text/HTML, it will be stringified.
	 * @param format - The file format: `'json'` (default), `'txt'`, or `'html'`.
	 * @returns The relative file path (from the tmp directory) of the stored data file.
	 * @throws {Error} If no namespace is set on this accessor.
	 */
	async setData(name: string, data: unknown, format: 'json' | 'txt' | 'html' = 'json') {
		if (this.#namespace == null) {
			throw new Error('"setData" method of the ArchiveAccessor API must set namespace');
		}
		const filePath = safePath(this.#tmpDir, this.#namespace, `${name}.${format}`);
		if (format === 'json') {
			await outputJSON(filePath, data);
		} else {
			await outputText(filePath, `${data}`);
		}
		return path.relative(this.#tmpDir, filePath);
	}

	/**
	 * Returns the total number of internal pages in the archive.
	 */
	async #getPageCount() {
		return this.#db.getPageCount();
	}

	/**
	 * Loads a batch of pages with their related data (redirects, anchors, referrers).
	 * When `withRefs` is false, loads only pages without relationships for better performance.
	 * @param offset - The number of pages to skip
	 * @param limit - The maximum number of pages to return
	 * @param options - URL parsing and referrer loading options
	 */
	async #getPagesWithRels(
		offset: number,
		limit: number,
		options?: ParseURLOptions & {
			withRefs?: boolean;
		},
	) {
		if (options?.withRefs === false) {
			const pages = await this.#db.getPages('internal-page', offset, limit);
			return pages.map((page) => new Page(this, page));
		}
		const { pages, redirects, anchors, referrers } = await this.#db.getPagesWithRels(
			offset,
			limit,
		);
		const redirectMap = new Map<number, DB_Redirect[]>();
		const anchorMap = new Map<number, DB_Anchor[]>();
		const refersMap = new Map<number, DB_Referrer[]>();
		log('Mapping redirects');
		for (const redirect of redirects) {
			const current = redirectMap.get(redirect.pageId);
			if (current) {
				current.push(redirect);
				continue;
			}
			redirectMap.set(redirect.pageId, [redirect]);
		}
		log('Mapping anchors');
		for (const anchor of anchors) {
			const current = anchorMap.get(anchor.pageId);
			if (current) {
				current.push(anchor);
				continue;
			}
			anchorMap.set(anchor.pageId, [anchor]);
		}
		log('Mapping referrers');
		for (const referrer of referrers) {
			const current = refersMap.get(referrer.pageId);
			if (current) {
				current.push(referrer);
				continue;
			}
			refersMap.set(referrer.pageId, [referrer]);
		}
		log('Create Page Data');
		const pPages: Page[] = [];
		for (const page of pages) {
			const pRedirects = redirectMap.get(page.id) || [];
			const pAnchors = anchorMap.get(page.id) || [];
			const pRefers = refersMap.get(page.id) || [];
			pPages.push(
				new Page(this, page, pRedirects, pAnchors, pRefers, options?.disableQueries),
			);
		}
		log('Create Page Data: Done');
		return pPages;
	}
}
