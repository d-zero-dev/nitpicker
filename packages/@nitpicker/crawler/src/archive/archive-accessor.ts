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
import { outputJSON } from './filesystem/output-json.js';
import { outputText } from './filesystem/output-text.js';
import { readJSON } from './filesystem/read-json.js';
import { readText } from './filesystem/read-text.js';
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
/**
 * Default timeout for {@link ArchiveAccessor.close}'s `db.destroy()` step.
 *
 * `knex.destroy()` will otherwise wait the full `acquireTimeoutMillis`
 * (10 minutes in this repo) for in-flight queries to drain. For a viewer
 * shut down by Ctrl-C while the live crawler holds a long write lock that
 * is an unacceptable user experience, so we bound the wait and treat the
 * accessor as closed after the timeout regardless.
 */
const DEFAULT_CLOSE_TIMEOUT_MS = 5000;

export class ArchiveAccessor extends EventEmitter<DatabaseEvent> {
	/**
	 * Promise tracking an in-progress (or completed) close. `null` means the
	 * accessor is open and idle; a settled promise means we are closed (the
	 * accessor stays "closed" even if `db.destroy()` rejected, because there
	 * is nothing safe to retry — see {@link ArchiveAccessor.close}).
	 */
	#closeOnce: Promise<void> | null = null;
	/** The SQLite database instance for querying archived data. */
	#db: Database;
	/** Namespace prefix for custom data storage (e.g. `"analysis/plugin-name"`). `null` disables `setData`. */
	#namespace: string | null = null;
	/**
	 * Whether this accessor was opened in read-only mode. With HTML stored
	 * as a SQLite BLOB, this no longer toggles any code path — the SELECT
	 * is identical for writer- and reader-mode accessors. Kept on the
	 * accessor so callers like the viewer can still surface "this archive
	 * is being read read-only" UI hints without re-deriving it.
	 */
	#readOnly: boolean;
	/** Absolute path to the temporary working directory containing the database and files. */
	#tmpDir: string;

	/**
	 * Whether this accessor was opened in read-only mode (no filesystem
	 * mutation on `tmpDir`).
	 */
	get readOnly(): boolean {
		return this.#readOnly;
	}

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
	 * @param options - Construction options.
	 * @param options.readOnly - When `true`, helpers must not mutate the
	 *   filesystem under `tmpDir` (used for live-crawl / stub-mode opens
	 *   where any write would race the crawler).
	 */
	constructor(
		tmpDir: string,
		db: Database,
		namespace: string | null = null,
		options: { readOnly?: boolean } = {},
	) {
		super();
		this.#tmpDir = tmpDir;
		this.#db = db;
		this.#namespace = namespace;
		this.#readOnly = options.readOnly ?? false;

		this.#db.on('error', (e) => {
			void this.emit('error', e);
		});
	}

	/**
	 * Enables `await using accessor = ...`. Delegates to {@link close} with
	 * the default timeout — callers that need a non-default `timeoutMs`
	 * must call `close` explicitly instead of relying on disposal.
	 *
	 * Dispatches through the instance's own `close`, so an `Archive`
	 * (which overrides `close`) gets its full teardown here too — this
	 * method does not need to be re-implemented on subclasses.
	 */
	async [Symbol.asyncDispose](): Promise<void> {
		await this.close();
	}

	/**
	 * Closes the underlying database connection.
	 *
	 * This is the **read-only** close path: it releases the SQLite handle and
	 * does nothing else. The temporary working directory is left untouched and
	 * no `.nitpicker` archive is produced. This makes it safe to call from
	 * read-only consumers (e.g. the viewer attached to an in-progress crawl's
	 * tmpDir), where touching the filesystem would race with — or destroy —
	 * the live crawler's working state.
	 *
	 * Subclasses that own the archive's lifecycle (notably `Archive`)
	 * override this to add write/cleanup steps.
	 *
	 * **Idempotent and concurrent-safe**: the first invocation captures the
	 * close promise; later invocations (from the same caller, a shutdown
	 * signal handler, or a parallel manager teardown) await the same
	 * promise and resolve together. If `db.destroy()` rejects, the
	 * rejection propagates to *all* awaiters and the accessor stays
	 * latched closed — a hung knex pool is not safe to "retry close".
	 *
	 * **Bounded**: when the optional `timeoutMs` (default {@link
	 * DEFAULT_CLOSE_TIMEOUT_MS}) elapses before `db.destroy()` settles, the
	 * call resolves with a warning. This prevents a viewer shutdown from
	 * being held for the underlying pool's 10-minute `acquireTimeoutMillis`
	 * when the live crawler holds the SQLite write lock.
	 * @param options - Close options.
	 * @param options.timeoutMs - Milliseconds to wait for `db.destroy()`
	 *   before giving up. Use `Infinity` to wait indefinitely (only
	 *   advisable in tests and batch jobs that own the DB exclusively).
	 */
	async close(options: { timeoutMs?: number } = {}): Promise<void> {
		if (this.#closeOnce) {
			return this.#closeOnce;
		}
		const timeoutMs = options.timeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
		this.#closeOnce = this.#runClose(timeoutMs);
		return this.#closeOnce;
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
	 * Retrieves the audios within the given page's detected main content
	 * region, from `page_main_content_audios`.
	 * @param pageId - The database id of the page.
	 * @returns Ordered audio rows.
	 */
	async getAudiosOfPage(pageId: number) {
		return this.#db.getAudiosOfPage(pageId);
	}
	/**
	 * Retrieves the button-like elements within the given page's detected
	 * main content region, from `page_main_content_buttons`.
	 * @param pageId - The database id of the page.
	 * @returns Ordered button rows.
	 */
	async getButtonsOfPage(pageId: number) {
		return this.#db.getButtonsOfPage(pageId);
	}
	/**
	 * Retrieves the canvases within the given page's detected main content
	 * region, from `page_main_content_canvases`.
	 * @param pageId - The database id of the page.
	 * @returns Ordered canvas rows.
	 */
	async getCanvasesOfPage(pageId: number) {
		return this.#db.getCanvasesOfPage(pageId);
	}
	/**
	 * Retrieves the crawl configuration stored in the archive database.
	 * @returns The parsed {@link Config} object.
	 */
	async getConfig(): Promise<Config> {
		return this.#db.getConfig();
	}
	/**
	 * Retrieves the Web Components (custom elements) within the given page's
	 * detected main content region, from `page_main_content_custom_elements`.
	 * @param pageId - The database id of the page.
	 * @returns Ordered custom-element rows.
	 */
	async getCustomElementsOfPage(pageId: number) {
		return this.#db.getCustomElementsOfPage(pageId);
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
	 * Retrieves the headings within the given page's detected main content
	 * region, from `page_main_content_headings`.
	 * @param pageId - The database id of the page.
	 * @returns Ordered heading rows.
	 */
	async getHeadingsOfPage(pageId: number) {
		return this.#db.getHeadingsOfPage(pageId);
	}
	/**
	 * Reads the HTML snapshot of a page from the archive.
	 *
	 * HTML is stored as zstd-compressed BLOBs in `page_html_blobs` (keyed by
	 * SHA-256 of the raw bytes) with `page_html_ref` linking `page_id → hash`.
	 * The read is a straight join + decompress; writer- and read-only (stub)
	 * accessors take the same code path because nothing here touches the
	 * filesystem.
	 *
	 * Returns `null` when the page row exists but has no stored body — for
	 * example a redirect source, a non-HTML resource (PDF), a page that
	 * failed to render, or an external page (whose row is metadata-only).
	 * Distinguishing "no body stored" from "empty body" is preserved: an
	 * empty HTML string returns `''`, not `null`.
	 *
	 * Throws if the page's referenced blob is missing or the codec marker
	 * is unrecognised — both indicate an archive that was truncated or
	 * written by a future tool, neither of which we silently paper over.
	 * @param pageId - The database id of the page to read.
	 * @returns The HTML content as a UTF-8 string, or `null` when no body
	 *   is stored for `pageId`.
	 * @example
	 * const html = await accessor.getHtmlOfPage(pageId);
	 * if (html === null) {
	 *   // page has no stored body — redirect source / non-HTML / failed render
	 * } else {
	 *   processHtml(html);
	 * }
	 */
	async getHtmlOfPage(pageId: number): Promise<string | null> {
		const html = await this.#db.getHtmlOfPageById(pageId);
		if (html === null) {
			log('No HTML body stored for page id=%d', pageId);
		}
		return html;
	}
	/**
	 * Retrieves the iframes within the given page's detected main content
	 * region, from `page_main_content_iframes`.
	 * @param pageId - The database id of the page.
	 * @returns Ordered iframe rows.
	 */
	async getIframesOfPage(pageId: number) {
		return this.#db.getIframesOfPage(pageId);
	}
	/**
	 * Retrieves the JSON-LD / SpeculationRules entries for the given page,
	 * parsed back from the `page_jsonld` table.
	 * @param pageId - The database id of the page.
	 * @returns Ordered entries with `kind`, `type`, `raw`, `parsed`, `parseError`.
	 */
	async getJsonLdOfPage(pageId: number) {
		return this.#db.getJsonLdOfPage(pageId);
	}

	/**
	 * Returns the underlying Knex query builder instance for direct SQL access.
	 * Enables advanced queries (GROUP BY, HAVING, JOINs) at the database layer
	 * for performance-critical operations on large datasets.
	 * @returns The Knex instance connected to the SQLite database.
	 */
	getKnex() {
		return this.#db.getKnex();
	}
	/**
	 * Retrieves the images within the given page's detected main content
	 * region, from `page_main_content_images`.
	 * @param pageId - The database id of the page.
	 * @returns Ordered image rows.
	 */
	async getMainContentImagesOfPage(pageId: number) {
		return this.#db.getMainContentImagesOfPage(pageId);
	}

	/**
	 * Retrieves the tables within the given page's detected main content
	 * region, from `page_main_content_tables`.
	 * @param pageId - The database id of the page.
	 * @returns Ordered table rows.
	 */
	async getMainContentTablesOfPage(pageId: number) {
		return this.#db.getMainContentTablesOfPage(pageId);
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
	 * Retrieves the confidence-combined technology roll-up for the given
	 * page, from the `page_technologies` table.
	 * @param pageId - The database id of the page.
	 * @returns Technology rows with category, version, confidence, signalCount.
	 */
	async getPageTechnologiesOfPage(pageId: number) {
		return this.#db.getPageTechnologiesOfPage(pageId);
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
	 * Retrieves the raw technology-detection signals for the given page,
	 * from the `technology_signals` table.
	 * @param pageId - The database id of the page.
	 * @returns Ordered signal rows with technology, signalType, evidence, weight.
	 */
	async getTechnologySignalsOfPage(pageId: number) {
		return this.#db.getTechnologySignalsOfPage(pageId);
	}

	/**
	 * Retrieves the videos within the given page's detected main content
	 * region, from `page_main_content_videos`.
	 * @param pageId - The database id of the page.
	 * @returns Ordered video rows.
	 */
	async getVideosOfPage(pageId: number) {
		return this.#db.getVideosOfPage(pageId);
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
	/**
	 * Actual close worker — invoked exactly once per accessor via
	 * {@link close}'s shared promise. Races `db.destroy()` against the
	 * caller-supplied timeout; on timeout we log and resolve so the
	 * consumer (typically a process shutting down) is not blocked, even
	 * though the underlying knex pool may still be draining in the
	 * background.
	 * @param timeoutMs - Maximum time to wait for `db.destroy()`.
	 */
	async #runClose(timeoutMs: number): Promise<void> {
		if (!Number.isFinite(timeoutMs)) {
			await this.#db.destroy();
			return;
		}
		let timer: NodeJS.Timeout | null = null;
		const timeout = new Promise<'timeout'>((resolve) => {
			timer = setTimeout(() => resolve('timeout'), timeoutMs);
		});
		// Track destroy() so we can attach an error-suppressing handler if we
		// give up waiting — otherwise a late rejection becomes an unhandled
		// promise rejection on the process.
		const destroy = this.#db.destroy().then(() => 'done' as const);
		try {
			const result = await Promise.race([destroy, timeout]);
			if (result === 'timeout') {
				log(
					'ArchiveAccessor.close: db.destroy() did not settle within %dms — giving up',
					timeoutMs,
				);
				destroy.catch((error) => {
					log(
						'ArchiveAccessor.close: late db.destroy() rejection (post-timeout): %O',
						error,
					);
				});
			}
		} finally {
			if (timer) {
				clearTimeout(timer);
			}
		}
	}
}
