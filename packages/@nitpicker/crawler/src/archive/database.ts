import type {
	Config,
	DatabaseOption,
	DB_Anchor,
	DB_Page,
	DB_Redirect,
	DB_Referrer,
	DB_Resource,
	DatabaseEvent,
	PageFilter,
} from './types.js';
import type { PageData, Resource } from '../utils/types/types.js';
import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';
import type { RetryDecoratorOptions } from '@d-zero/shared/retry';
import type { Knex } from 'knex';

import { existsSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { retry } from '@d-zero/shared/retry';
import { pathComparator } from '@d-zero/shared/sort/path';
import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';
import knex from 'knex';

import { findScopeEntry } from '../crawler/find-scope-entry.js';
import { isHtmlContentType } from '../crawler/is-html-content-type.js';
import { normalizeContentType } from '../crawler/normalize-content-type.js';
import { eachSplitted } from '../utils/array/each-splitted.js';
import { ErrorEmitter } from '../utils/error/error-emitter.js';

import { dbLog } from './debug.js';
import { mkdir } from './filesystem/mkdir.js';
import { getJSON } from './get-json.js';
import { initSchema } from './init-schema.js';
import { LibsqlDialect } from './libsql-dialect.js';
import { limitedPageIds } from './limited-page-ids.js';
import { migrateInfoRoots } from './migrate-info-roots.js';
import { migratePageErrors } from './migrate-page-errors.js';
import { redirectTable } from './redirect-table.js';
import { resolveRedirectChain } from './resolve-redirect-chain.js';

const retrySetting: RetryDecoratorOptions = {
	interval: 300,
	retries: 3,
};

/**
 * Columns of the `info` table that `setConfig` / `updateConfig` are allowed to
 * write. Any key outside this set is silently dropped so callers can splat a
 * wider runtime config (with extras like `cwd`) without hitting "no such
 * column" at the SQL layer.
 */
const INFO_COLUMN_ALLOWLIST: ReadonlySet<string> = new Set<keyof Config>([
	'version',
	'name',
	'baseUrl',
	'roots',
	'recursive',
	'interval',
	'image',
	'fetchExternal',
	'parallels',
	'excludes',
	'excludeKeywords',
	'excludeUrls',
	'maxExcludedDepth',
	'retry',
	'fromList',
	'disableQueries',
	'userAgent',
	'ignoreRobots',
]);

/**
 * Subset of {@link INFO_COLUMN_ALLOWLIST} that is stored as a JSON-encoded
 * string and therefore needs `JSON.stringify` on write.
 */
const INFO_JSON_COLUMNS: ReadonlySet<string> = new Set<keyof Config>([
	'roots',
	'excludes',
	'excludeKeywords',
	'excludeUrls',
]);

/**
 * Low-level database abstraction layer for the archive's SQLite database.
 *
 * Manages the `pages`, `anchors`, `images`, `resources`, and `resources-referrers`
 * tables. All public methods that perform database queries use the `@retryable`
 * decorator for automatic retry on transient failures, and `@ErrorEmitter` to
 * propagate errors as events.
 *
 * Use the static {@link Database.connect} factory method to create instances.
 * The constructor is private.
 */
export class Database extends EventEmitter<DatabaseEvent> {
	/** The Knex query builder instance connected to the SQLite database. */
	#instance: Knex;
	/** Absolute path to the working directory, used for resolving relative snapshot paths. */
	#workingDir: string;
	// eslint-disable-next-line no-restricted-syntax
	private constructor(options: DatabaseOption) {
		super();
		this.#workingDir = options.workingDir;
		this.#instance = knex({
			client: LibsqlDialect,
			connection: {
				filename: options.filename,
			},
			useNullAsDefault: true,
			pool: {
				acquireTimeoutMillis: 600_000,
			},
		});
	}

	/**
	 * Adds the `order` column to the `pages` table for URL sort ordering.
	 * If the column already exists, this method does nothing.
	 * @deprecated Since v0.1.x. The column is now created during table initialization.
	 * @returns The result of the schema alteration, or void if the column already exists.
	 */
	async addOrderField() {
		const hasColumn = await this.#instance.schema.hasColumn('pages', 'order');
		if (hasColumn) {
			return;
		}
		return await this.#instance.schema.table('pages', (t) => {
			t.integer('order').unsigned().nullable().defaultTo(null);
		});
	}
	/**
	 * Forces a WAL checkpoint, writing all pending WAL data back to the main database file.
	 * Uses TRUNCATE mode to reset the WAL file to zero bytes after checkpointing.
	 * This ensures the database is fully self-contained in `db.sqlite` before archiving.
	 */
	async checkpoint() {
		await this.#instance.raw('PRAGMA wal_checkpoint(TRUNCATE)');
	}
	/**
	 * Clears the HTML snapshot path for a page.
	 * Used to roll back the snapshot reference when the snapshot file write fails.
	 * @param pageId - The database ID of the page whose HTML path should be cleared.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async clearHtmlPath(pageId: number) {
		await this.#instance<DB_Page>('pages').where('id', pageId).update({ html: null });
	}
	/**
	 * Destroys the database connection, releasing all pooled resources.
	 */
	async destroy() {
		await this.#instance.destroy();
	}
	/**
	 * Retrieves all anchors (outgoing links) on a specific page.
	 * Joins the `anchors` table with the `pages` table to resolve link destinations.
	 * @param pageId - The database ID of the page whose anchors to retrieve.
	 * @returns An array of anchor records with resolved URL, title, status, and content type.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getAnchorsOnPage(pageId: number) {
		const res = await this.#instance
			.select(
				'pages.url',
				'pages.title',
				'pages.status',
				'pages.statusText',
				'pages.contentType',
				'anchors.hash',
				'anchors.textContent',
			)
			.from('anchors')
			.join('pages', 'anchors.hrefId', '=', 'pages.id')
			.where('anchors.pageId', pageId);
		return res;
	}
	/**
	 * Retrieves the base URL of the crawl session from the `info` table.
	 * @returns The base URL string.
	 * @throws {Error} If no base URL is found in the database.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getBaseUrl() {
		const selected = await this.#instance.select('baseUrl').from<Config>('info');
		if (!selected[0]) {
			throw new Error('No baseUrl');
		}
		const [{ baseUrl }] = selected;
		return baseUrl || '';
	}
	/**
	 * Retrieves the full crawl configuration from the `info` table.
	 * Deserializes JSON-encoded fields (`roots`, `excludes`, `excludeKeywords`, `excludeUrls`).
	 * @returns The parsed {@link Config} object.
	 * @throws {Error} If no configuration is found in the database.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getConfig() {
		const [config] = await this.#instance.select('*').from<Config>('info');
		if (!config) {
			throw new Error('No config');
		}
		const opt: Config = {
			...config,
			excludes: getJSON<string[]>(config.excludes, []),
			excludeKeywords: getJSON<string[]>(config.excludeKeywords, []),
			excludeUrls: getJSON<string[]>(config.excludeUrls, []),
			roots: getJSON<string[]>(config.roots, []),
			retry: config.retry ?? 3,
		};
		// @ts-expect-error — `id` is the primary key, not part of the public Config shape
		delete opt.id;
		dbLog('Table `info`: %O => %O', config, opt);
		return opt;
	}
	/**
	 * Retrieves the current crawling state by listing scraped and pending URLs.
	 * @returns An object with `scraped` (completed URLs) and `pending` (remaining URLs) arrays.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getCrawlingState() {
		const ex = (r: { url: string }) => r.url;
		const $scraped = await this.#instance
			.select('url')
			.from<DB_Page>('pages')
			.where('scraped', 1);
		const scraped = $scraped.map(ex);
		const $pending = await this.#instance
			.select('url')
			.from<DB_Page>('pages')
			.where('scraped', 0);
		const pending = $pending.map(ex);
		return {
			scraped,
			pending,
		};
	}
	/**
	 * Retrieves the HTML snapshot file path for a specific page.
	 * @param pageId - The database ID of the page.
	 * @returns The relative file path to the HTML snapshot, or null if not saved.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getHtmlPathOnPage(pageId: number) {
		return await this.#instance.transaction(async (trx) => {
			const [{ html }] = await trx
				.select('html')
				.from<DB_Page>('pages')
				.where('id', pageId);
			return html || null;
		});
	}
	/**
	 * Returns the underlying Knex query builder instance for direct SQL access.
	 * This enables advanced queries (GROUP BY, HAVING, JOINs) at the database
	 * layer for performance with large datasets.
	 * @returns The Knex instance connected to the SQLite database.
	 */
	getKnex(): Knex {
		return this.#instance;
	}
	/**
	 * Retrieves the crawl session name from the `info` table.
	 * @returns The name string.
	 * @throws {Error} If no name is found in the database.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getName() {
		const selected = await this.#instance.select('name').from<Config>('info');
		if (!selected[0]) {
			throw new Error('No name');
		}
		const [{ name }] = selected;
		return name;
	}
	/**
	 * Counts the total number of pages in the database.
	 * @returns The total page count.
	 * @throws {Error} If the count query fails.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getPageCount() {
		const selected = await this.#instance.count('id').from<DB_Page>('pages');
		if (!selected[0]) {
			throw new Error('No count');
		}
		// @ts-expect-error
		const count: number = selected[0]['count(`id`)'];
		dbLog('Number of pages: %d', count);
		return count;
	}
	/**
	 * Retrieves pages from the database with optional filtering, pagination via offset and limit.
	 * @param filter - An optional {@link PageFilter} to narrow results by content type and origin.
	 * @param offset - The number of rows to skip. Defaults to `0`.
	 * @param limit - The maximum number of rows to return. Defaults to `100000`.
	 * @returns An array of raw {@link DB_Page} rows.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getPages(filter?: PageFilter, offset = 0, limit = 100_000) {
		const q = this.#instance.select('*').from<DB_Page>('pages');
		switch (filter) {
			case 'page': {
				return q
					.where({
						contentType: 'text/html',
						isTarget: 1,
					})
					.limit(limit)
					.offset(offset);
			}
			case 'page-included-no-target': {
				return q
					.where({
						contentType: 'text/html',
					})
					.limit(limit)
					.offset(offset);
			}
			case 'external-page': {
				return q
					.where({
						contentType: 'text/html',
						isExternal: 1,
					})
					.limit(limit)
					.offset(offset);
			}
			case 'internal-page': {
				return q
					.where({
						contentType: 'text/html',
						isExternal: 0,
					})
					.limit(limit)
					.offset(offset);
			}
			case 'no-page': {
				return q
					.whereNull('contentType')
					.orWhereNot({
						contentType: 'text/html',
					})
					.limit(limit)
					.offset(offset);
			}
			case 'external-no-page': {
				return q
					.where((qb) => {
						qb.whereNull('contentType').orWhereNot({
							contentType: 'text/html',
						});
					})
					.andWhere({
						isExternal: 1,
					})
					.limit(limit)
					.offset(offset);
			}
			case 'internal-no-page': {
				return q
					.where((qb) => {
						qb.whereNull('contentType').orWhereNot({
							contentType: 'text/html',
						});
					})
					.andWhere({
						isExternal: 0,
					})
					.limit(limit)
					.offset(offset);
			}
		}
		return q.limit(limit).offset(offset);
	}
	/**
	 * Retrieves pages along with their related redirect, anchor, and referrer data.
	 * Results are ordered by the natural URL sort order. Only non-redirected pages are returned.
	 * @param offset - The number of rows to skip.
	 * @param limit - The maximum number of pages to return.
	 * @returns An object containing `pages`, `redirects`, `anchors`, and `referrers` arrays.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getPagesWithRels(offset: number, limit: number) {
		await this.addOrderField();
		await this.setUrlOrder();
		dbLog('Get Pages');
		const pages = await this.#instance
			.select('*')
			.from<DB_Page>('pages')
			.orderByRaw('`order` ASC NULLS LAST')
			.whereNull('redirectDestId')
			.limit(limit)
			.offset(offset);

		// When empty
		if (pages.length === 0) {
			return {
				pages: [],
				redirects: [],
				referrers: [],
				anchors: [],
			};
		}

		dbLog('Get Pages: Redirects');
		const redirects: DB_Redirect[] = await this.#instance
			.with('limitedPages', limitedPageIds(limit, offset))
			.with('redirect', redirectTable(false))
			.select('id as pageId', 'from', 'fromId')
			.from('redirect')
			// Filter
			.join('limitedPages', 'redirect.toId', '=', 'limitedPages.id')
			// Sort
			.orderBy('id', 'asc');

		dbLog('Get Pages: Anchors');
		const anchors: DB_Anchor[] = await this.#instance
			.with('limitedPages', limitedPageIds(limit, offset))
			.with('redirect', redirectTable())
			.select(
				'limitedPages.id as pageId',
				'href.url',
				'redirect.from as href',
				'href.isExternal',
				'href.title',
				'href.status',
				'href.statusText',
				'href.contentType',
				'anchors.hash',
				'anchors.textContent',
			)
			.from('anchors')
			// Filters
			.join('limitedPages', 'anchors.pageId', '=', 'limitedPages.id')
			// Resolves redirect
			.join('redirect', 'anchors.hrefId', '=', 'redirect.fromId')
			// Target
			.join('pages as href', 'redirect.toId', '=', 'href.id')
			// Sort
			.orderBy('anchors.id', 'asc');

		dbLog('Get Pages: Referrers');
		const referrers: DB_Referrer[] = await this.#instance
			.with('limitedPages', limitedPageIds(limit, offset))
			.with('redirect', redirectTable())
			.select(
				'redirect.toId as pageId',
				'referrer.url',
				'redirect.from as through',
				'redirect.fromId as throughId',
				'anchors.hash',
				'anchors.textContent',
			)
			.from('anchors')
			// Resolves redirect
			.join('redirect', 'anchors.hrefId', '=', 'redirect.fromId')
			// Referrer
			.join('pages as referrer', 'anchors.pageId', '=', 'referrer.id')
			// Filters
			.join('limitedPages', 'redirect.toId', '=', 'limitedPages.id')
			// Sort
			.orderBy('anchors.id', 'asc');

		dbLog('Get Pages: Done');
		return {
			pages,
			redirects,
			anchors,
			referrers,
		};
	}
	/**
	 * Retrieves redirect sources for the given page IDs in bulk.
	 * @param pageIds - The database IDs of the destination pages.
	 * @returns An array of {@link DB_Redirect} records mapping destination pages to their redirect sources.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getRedirectsForPages(pageIds: number[]): Promise<DB_Redirect[]> {
		if (pageIds.length === 0) return [];
		return this.#instance
			.select('redirectDestId as pageId', 'url as from', 'id as fromId')
			.from('pages')
			.whereIn('redirectDestId', pageIds);
	}
	/**
	 * Retrieves pages that link to a specific page (incoming links / referrers).
	 * @param pageId - The database ID of the target page.
	 * @returns An array of referrer records with URL, hash, and text content.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getReferrersOfPage(pageId: number) {
		const res = await this.#instance
			.select('pages.url', 'anchors.hash', 'anchors.textContent')
			.from('anchors')
			.join('pages', 'anchors.pageId', '=', 'pages.id')
			.where('anchors.hrefId', pageId);
		return res;
	}
	/**
	 * Retrieves the page URLs that reference a specific resource.
	 * @param id - The database ID of the resource.
	 * @returns An array of page URL strings that reference the resource.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getReferrersOfResource(id: number): Promise<string[]> {
		const res = await this.#instance
			.select('pages.url')
			.from('resources-referrers')
			.join('resources', 'resources.id', '=', 'resources-referrers.resourceId')
			.join('pages', 'pages.id', '=', 'resources-referrers.pageId')
			.where('resources.id', id);
		return res.map((r) => r.url);
	}
	/**
	 * Retrieves a single sub-resource from the `resources` table by its URL.
	 *
	 * Accepts multiple URL candidates because the stored key is the resource's
	 * `href` while callers may only know the hash-stripped form; the first match
	 * wins.
	 *
	 * Deliberately NOT decorated with `@ErrorEmitter`: the only caller (the
	 * crawler's resource-reuse hook) has a full fallback (the HEAD pre-flight),
	 * so a read failure here must not surface as a database `error` event —
	 * the orchestrator aborts the whole crawl on that event, which is the
	 * correct reaction to write failures but not to a recoverable read.
	 * @param urls - URL candidates to match against the `url` column.
	 * @returns The raw {@link DB_Resource} row, or `null` if none match.
	 */
	@retry(retrySetting)
	async getResourceByUrl(urls: readonly string[]): Promise<DB_Resource | null> {
		const res = await this.#instance
			.select('*')
			.from<DB_Resource>('resources')
			.whereIn('url', [...urls])
			.first();
		return res ?? null;
	}
	/**
	 * Retrieves all sub-resources from the `resources` table.
	 * @returns An array of raw {@link DB_Resource} rows.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getResources() {
		return this.#instance.select('*').from<DB_Resource>('resources');
	}
	/**
	 * Retrieves a flat list of all resource URLs from the `resources` table.
	 * @returns An array of resource URL strings.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getResourceUrlList() {
		const res = await this.#instance.select('url').from<DB_Resource>('resources');
		return res.map((r) => r.url);
	}
	/**
	 * Counts pages that were scraped as crawl targets (full HTML render).
	 *
	 * Used by the crawler to seed its `pagesScraped` counter on resume so the
	 * progress display reflects all browser-rendered HTML pages across sessions,
	 * not just the current one.
	 *
	 * "HTML page" is guaranteed by `contentType = 'text/html'`, NOT by `isTarget`
	 * alone: `isTarget` means "in-scope crawl target" and is set for in-scope
	 * non-HTML resources too (e.g. a PDF reached via the HEAD pre-flight is
	 * `isTarget = 1`). Counting those would over-report the HTML page total, so
	 * page-ness is asserted at the read layer here rather than by trusting
	 * `isTarget`.
	 * @returns The number of `text/html` rows with `isTarget = 1` and `scraped = 1`.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getScrapedHtmlPageCount() {
		const [row] = await this.#instance
			.from<DB_Page>('pages')
			.where('isTarget', 1)
			.andWhere('scraped', 1)
			.andWhere('contentType', 'text/html')
			.count<{ count: number }[]>('* as count');
		return row ? Number(row.count) : 0;
	}

	/**
	 * Records a partial scrape failure against the page identified by `url`.
	 *
	 * The page row is resolved (or inserted as a stub) via
	 * {@link Database.#getIdByUrl} so the error can be recorded even before
	 * `setPage` has run — useful when the failure fires during scraping
	 * (e.g. mid-`scrapeStart`) and the orchestrator enqueues this write
	 * before the success write for the same URL.
	 *
	 * A single page can have multiple `page_errors` rows (e.g. both
	 * `desktop-compact` and `mobile-small` viewports failing).
	 * @param url - URL of the page being scraped.
	 * @param phase - Scrape phase name (typically `'retryExhausted'`).
	 * @param message - Human-readable failure message.
	 * @param isExternal - Whether the URL is external. Defaults to `false`.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async insertPageError(url: string, phase: string, message: string, isExternal = false) {
		const pageId = await this.#getIdByUrl(url, isExternal ? 1 : 0);
		await this.#instance('page_errors').insert({
			pageId,
			phase,
			message,
			createdAt: Date.now(),
		});
	}
	/**
	 * Inserts a sub-resource into the `resources` table.
	 * Ignores duplicate URLs (uses `ON CONFLICT IGNORE`).
	 * @param resource - The resource data to insert.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async insertResource(resource: Resource) {
		await this.#instance
			.from<DB_Resource>('resources')
			.insert({
				url: resource.url.href,
				isExternal: resource.isExternal ? 1 : 0,
				status: resource.status,
				statusText: resource.statusText,
				// Canonicalize like `pages.contentType` (see #insertPage) so resource
				// content-type filters / dedupe keys are case- and whitespace-stable.
				contentType: normalizeContentType(resource.contentType),
				contentLength: resource.contentLength,
				compress: resource.compress || 0,
				cdn: resource.cdn || 0,
				responseHeaders: JSON.stringify(resource.headers),
			})
			.onConflict('url')
			.ignore();
	}

	/**
	 * Inserts a referrer relationship between a resource and a page into the
	 * `resources-referrers` table. Silently skips if the resource is not found.
	 * @param src - The URL of the resource.
	 * @param pageUrl - The URL of the page that references the resource.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async insertResourceReferrers(src: string, pageUrl: string) {
		const selected = await this.#instance
			.select('id')
			.from<DB_Resource>('resources')
			.where('url', src);
		if (!selected[0]) {
			// Ignore when the resource is not found
			return;
		}
		const [{ id: resourceId }] = selected;
		const pageId = await this.#getIdByUrl(pageUrl);
		await this.#instance('resources-referrers')
			.insert({
				resourceId,
				pageId,
			})
			.onConflict(['resourceId', 'pageId'])
			.ignore();
	}

	/**
	 * Records a redirect edge (source → destination) **without** re-storing the
	 * destination's content.
	 *
	 * The crawler renders a many-to-one redirect destination exactly once. For
	 * every subsequent source URL that redirects to that already-rendered
	 * destination, it calls this instead of {@link updatePage} (#73). Routing a
	 * content-less HEAD result through `updatePage` would funnel it into
	 * `#insertPage` and overwrite the destination's good title / meta with empty
	 * values, so the dedicated edge-only path is required.
	 *
	 * The destination row is resolved (created on demand if a concurrent in-flight
	 * render has not committed it yet) so the edge always points at a valid id;
	 * the single render fills in the destination's content under that same id.
	 * The destination's existing anchors / images are never touched here.
	 * @param page - HEAD-resolved page data carrying the redirect chain. Its
	 *   `anchorList` / `imageList` are ignored (a redirect source owns no content).
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async recordRedirect(page: PageData): Promise<void> {
		const { destUrl, sources } = resolveRedirectChain(
			page.url.withoutHashAndAuth,
			page.redirectPaths,
		);

		// No redirect chain (the URL is itself the already-rendered destination,
		// reached both directly and via a redirect) → there is no edge to write.
		// Returning here avoids opening a transaction and, crucially, avoids
		// `#getIdByUrl` inserting a content-less placeholder row for a destination
		// that may not have been written yet.
		if (sources.length === 0) {
			return;
		}

		const destUrlObject = parseUrl(destUrl);

		if (!destUrlObject) {
			// A malformed redirect target should not abort the whole crawl (this
			// runs inside the WriteQueue, whose rejection aborts the run). Recording
			// a single redirect edge is best-effort, so skip it and move on. Unlike
			// `updatePage`, there is no page content at stake here.
			dbLog('recordRedirect: skip malformed destination URL: %s', destUrl);
			return;
		}

		await this.#instance.transaction(async (trx) => {
			const destId = await this.#getIdByUrl(
				destUrlObject.withoutHashAndAuth,
				undefined,
				trx,
			);
			await this.#linkRedirectSources(
				trx,
				sources,
				destId,
				destUrlObject.withoutHashAndAuth,
				page.isExternal,
			);
		});
	}
	/**
	 * Promote previously-external pages whose URL falls under any of the new scope
	 * entries back to a "needs scraping" state so that the next crawl picks them up
	 * as full internal pages.
	 *
	 * For each matching page:
	 * - clears the scrape metadata (status, headers, snapshot path, etc.),
	 * - flips `isExternal` to `0` and `scraped` to `0`,
	 * - removes stale `anchors`, `images`, and `resources-referrers` rows so that
	 *   the re-scrape can re-insert fresh ones without duplicates.
	 *
	 * The page row itself is kept (id is preserved) so existing referrers via
	 * `anchors.hrefId` remain valid. SELECT and UPDATE/DELETE statements are
	 * chunked to stay below SQLite's `SQLITE_LIMIT_VARIABLE_NUMBER`.
	 * @param scopes - The hostname-indexed scope map after the new roots are merged.
	 * @param options - URL parsing options forwarded to {@link findScopeEntry}.
	 * @returns The URLs of the pages that were promoted.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async repromoteExternalPages(
		scopes: ReadonlyMap<string, readonly ExURL[]>,
		options?: ParseURLOptions,
	): Promise<string[]> {
		if (scopes.size === 0) {
			return [];
		}
		const candidates = await this.#instance
			.select('id', 'url')
			.from<DB_Page>('pages')
			.where('isExternal', 1);

		const promotedIds: number[] = [];
		const promotedUrls: string[] = [];
		for (const row of candidates) {
			const parsed = parseUrl(row.url, options);
			if (!parsed) {
				continue;
			}
			if (findScopeEntry(parsed, scopes, options) === null) {
				continue;
			}
			promotedIds.push(row.id);
			promotedUrls.push(row.url);
		}
		if (promotedIds.length === 0) {
			return [];
		}

		const chunkSize = 500;
		for (let i = 0; i < promotedIds.length; i += chunkSize) {
			const chunk = promotedIds.slice(i, i + chunkSize);
			await this.#instance<DB_Page>('pages').whereIn('id', chunk).update({
				scraped: 0,
				isExternal: 0,
				isSkipped: 0,
				skipReason: null,
				html: null,
				status: null,
				statusText: null,
				contentType: null,
				contentLength: null,
				responseHeaders: '{}',
				redirectDestId: null,
			});
			// Clear the prior crawl's data for the repromoted pages. `updatePage`
			// also replaces anchors/images when it re-scrapes them, but only when
			// the new scrape is non-empty — so this pre-clear is still load-bearing
			// for pages that get repromoted but then re-scrape to nothing (or are
			// never reached again), and it is the only place `resources-referrers`
			// is cleared.
			await this.#instance('anchors').whereIn('pageId', chunk).delete();
			await this.#instance('images').whereIn('pageId', chunk).delete();
			await this.#instance('resources-referrers').whereIn('pageId', chunk).delete();
		}
		dbLog('Repromoted %d external pages back to pending', promotedUrls.length);
		return promotedUrls;
	}
	/**
	 * Stores the crawl configuration in the `info` table.
	 * Only fields in {@link INFO_COLUMN_ALLOWLIST} are forwarded — any extra
	 * runtime-only field on the input is silently dropped so callers can splat
	 * a wider config object without producing SQL errors. JSON-array fields
	 * are serialized via `JSON.stringify`.
	 * @param config - The {@link Config} object to store.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async setConfig(config: Config) {
		const payload: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(config)) {
			if (!INFO_COLUMN_ALLOWLIST.has(key)) {
				continue;
			}
			payload[key] = INFO_JSON_COLUMNS.has(key) ? JSON.stringify(value) : value;
		}
		return this.#instance.from<Config>('info').insert(payload);
	}

	/**
	 * Marks a page as skipped in the database with the given reason.
	 * Creates the page row if it does not already exist.
	 * @param url - The URL of the skipped page.
	 * @param reason - The reason the page was skipped.
	 * @param isExternal - Whether the page is on an external domain. Defaults to `false`.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async setSkippedPage(url: string, reason: string, isExternal = false) {
		const pageId = await this.#getIdByUrl(url, isExternal ? 1 : 0);
		await this.#instance<DB_Page>('pages')
			.where('id', pageId)
			.update({
				scraped: 1,
				isExternal: isExternal ? 1 : 0,
				isSkipped: 1,
				skipReason: reason,
			});
	}

	/**
	 * Assigns natural URL sort order values to all internal pages.
	 * Pages are sorted using {@link pathComparator} and assigned sequential order numbers.
	 */
	async setUrlOrder() {
		dbLog('Set URL Order');
		const res = await this.#instance
			.select('id', 'url')
			.from<DB_Page>('pages')
			.where('isExternal', '=', 0);
		const sorted = res.toSorted((a, b) => pathComparator(a.url, b.url));

		// Batch update using chunked CASE statements to avoid N+1 queries
		const BATCH_SIZE = 500;
		for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
			const batch = sorted.slice(i, i + BATCH_SIZE);
			const ids = batch.map((row) => row.id);
			const bindings: (string | number)[] = [];
			const cases = batch
				.map((row, j) => {
					bindings.push(row.id, i + j + 1);
					return 'WHEN ? THEN ?';
				})
				.join(' ');
			const placeholders = ids.map(() => '?').join(',');
			await this.#instance.raw(
				`UPDATE pages SET \`order\` = CASE id ${cases} END WHERE id IN (${placeholders})`,
				[...bindings, ...ids],
			);
		}
	}
	/**
	 * Update the single row in the `info` table with a partial config patch.
	 *
	 * Used by the append flow to extend `roots` (and any other tweakable
	 * field) without replacing the entire row. JSON-array fields are serialized on
	 * the fly; primitive fields are written verbatim. Unspecified fields stay as-is.
	 *
	 * Unknown keys (anything outside the allow-list of `info`-table columns) are
	 * silently dropped instead of being passed to SQL, so callers that splat a
	 * wider runtime config (e.g. `CrawlConfig` with `cwd` / `executablePath`)
	 * cannot accidentally trigger a "no such column" SQL error.
	 * @param patch - Partial {@link Config} fields to overwrite. `undefined` values are skipped.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async updateConfig(patch: Partial<Config>): Promise<void> {
		const payload: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(patch)) {
			if (value === undefined) {
				continue;
			}
			if (!INFO_COLUMN_ALLOWLIST.has(key)) {
				continue;
			}
			if (INFO_JSON_COLUMNS.has(key)) {
				payload[key] = JSON.stringify(value);
				continue;
			}
			payload[key] = value;
		}
		if (Object.keys(payload).length === 0) {
			return;
		}
		await this.#instance.from<Config>('info').update(payload);
	}

	/**
	 * Inserts or updates a crawled page in the database, including its redirect chain,
	 * anchors, and images. Optionally creates an HTML snapshot file path entry.
	 *
	 * Self-redirects (where the source URL equals the destination URL after normalization)
	 * are skipped to avoid marking a page as redirected to itself — a situation caused by
	 * authentication challenges (e.g. Basic Auth 302) that would otherwise exclude the page
	 * from reports via the `whereNull('redirectDestId')` filter.
	 * @param page - The page data to store.
	 * @param snapshotDir - The directory for saving HTML snapshots, or null to skip snapshots.
	 * @param isTarget - Whether this page is a crawl target.
	 * @returns An object with the optional `html` snapshot file path and the page's database `pageId`.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async updatePage(
		page: PageData,
		snapshotDir: string | null,
		isTarget: boolean,
	): Promise<{
		html?: string | undefined;
		pageId: number;
	}> {
		const { destUrl, sources } = resolveRedirectChain(
			page.url.withoutHashAndAuth,
			page.redirectPaths,
		);

		const destUrlObject = parseUrl(destUrl);

		if (!destUrlObject) {
			throw new Error(`Failed to parse URL: ${destUrl}`);
		}

		return await this.#instance.transaction(async (trx) => {
			const pageId = await this.#insertPage(
				{
					...page,
					url: destUrlObject,
				},
				isTarget,
				trx,
			);

			await this.#linkRedirectSources(
				trx,
				sources,
				pageId,
				destUrlObject.withoutHashAndAuth,
				page.isExternal,
			);
			let snapshot: { html?: string; pageId: number } = { pageId };
			// Only write an HTML snapshot when there is actual HTML to write.
			// `page.html.length > 0` is the precise signal: the scraper returns
			// `html: ''` for everything that is not a rendered `text/html` document
			// (non-HTML responses, metadata-only, external, degraded renders), so a
			// non-empty `html` is exactly "a rendered HTML body exists". Gating on
			// `isTarget` alone wrote a 0-byte snapshot (and set `pages.html`) for
			// every internal non-HTML resource — PDF / zip / images are isTarget=1 —
			// flooding the archive with empty files pointing at meaningless paths (#72).
			//
			// `isTarget` is intentionally NOT part of this condition: it is implied by
			// `html.length > 0` (only in-scope target pages are browser-rendered into a
			// non-empty body; metadata-only and external pages carry `html: ''`), so the
			// content check alone expresses the intent without a redundant term.
			if (snapshotDir && page.html.length > 0) {
				snapshot = await this.#updateSnapshotPath(pageId, snapshotDir, trx);
			} else if (
				snapshotDir &&
				page.contentType !== null &&
				!isHtmlContentType(page.contentType)
			) {
				// The page is now a *known* non-HTML type. If a previous scrape stored
				// an HTML snapshot for this URL (e.g. it served HTML then was replaced
				// by a PDF across `crawl --resume` / `--append`), clear the stale path
				// so `pages.html` never contradicts `contentType`. A degraded HTML
				// re-scrape (text/html or unknown content type with empty html) is NOT
				// cleared — the last good snapshot is preserved, mirroring the
				// anchors / images empty-guard below. Gated on `snapshotDir` because a
				// stale path can only have been written by a snapshot-capable call
				// (`setPage`); `setExternalPage` passes `snapshotDir = null` and never
				// sets `html`, so it has nothing to clear.
				await trx<DB_Page>('pages').where('id', pageId).update({ html: null });
			}
			// Re-scrape semantics: the same URL can be scraped more than once
			// (e.g. `crawl --resume`, re-visits, `--append` re-promotion). The
			// `anchors` / `images` tables have no uniqueness constraint, so
			// re-inserting without clearing would accumulate a full duplicate set
			// on every re-scrape (the bug fixed in #70). So we delete-then-insert
			// to *replace* the previous rows.
			//
			// The delete is paired with — and guarded by — a non-empty new list:
			// a degraded re-scrape (navigation timeout / partial render) can return
			// an empty `anchorList` for a page that previously had links, and
			// wiping the prior good data in that case would be destructive. We
			// cannot tell a transient empty result apart from a page that has
			// legitimately lost all its links, so we err on the side of keeping
			// what we already had. The accepted trade-off is that a page which
			// genuinely dropped to zero links keeps its stale rows until the next
			// non-empty re-scrape replaces them.
			//
			// (A DB-level unique constraint + `onConflict` would also prevent
			// duplication, but multiple distinct anchors can share the same
			// hrefId/hash/textContent legitimately, so there is no natural unique
			// key to enforce — replace-on-write is the correct mechanism here.)
			const anchors = await Promise.all(
				page.anchorList.map(async (anchor) => {
					const hrefId = await this.#getIdByUrl(
						anchor.href.withoutHashAndAuth,
						anchor.isExternal ? 1 : 0,
						trx,
					);
					return {
						pageId,
						hrefId,
						hash: anchor.href.hash,
						textContent: anchor.textContent,
					};
				}),
			);
			dbLog('Insert anchors.length: %d', anchors.length);
			if (anchors.length > 0) {
				await trx('anchors').where('pageId', pageId).delete();
				await eachSplitted(anchors, 100, async (_anchors) => {
					await trx('anchors').insert(_anchors);
				});
			}
			const images = page.imageList.map((image) => ({
				pageId,
				...image,
			}));
			dbLog('Insert images.length: %d', images.length);
			if (images.length > 0) {
				await trx('images').where('pageId', pageId).delete();
				await eachSplitted(images, 100, async (_images) => {
					await trx('images').insert(_images);
				});
			}
			return snapshot;
		});
	}

	/**
	 * Returns the database ID for a URL, creating a new page row if needed.
	 * Uses `ON CONFLICT IGNORE` to handle race conditions in concurrent inserts.
	 * @param url
	 * @param isExternal
	 * @param trx
	 */
	async #getIdByUrl(url: string, isExternal?: 0 | 1, trx?: Knex.Transaction) {
		const qb = trx ?? this.#instance;
		const [record] = await qb.select('id').from<DB_Page>('pages').where('url', url);
		// Must use `?` because it may be `undefined`
		const pageId = record?.id ?? Number.NaN;
		if (Number.isFinite(pageId)) {
			return pageId;
		}
		const insertedRows = await qb<DB_Page>('pages')
			.insert({
				url,
				scraped: 0,
				isTarget: 0,
				...(isExternal != null && { isExternal }),
			})
			.onConflict('url')
			.ignore();
		const [insertedId] = insertedRows;
		if (!insertedId) {
			// onConflict.ignore() returns 0 on race condition — re-select
			const [existing] = await qb.select('id').from<DB_Page>('pages').where('url', url);
			if (existing?.id) {
				return existing.id;
			}
			throw new Error(`Failed to insert a new page: ${url}`);
		}
		return insertedId;
	}
	/**
	 * Initializes the database schema if tables do not exist, then runs lightweight
	 * migrations that bring older archives up to the current schema.
	 *
	 * Migrations are idempotent and run on every writer-side {@link Database.connect};
	 * in read-only mode they are SKIPPED so the same DB can be opened safely
	 * by a viewer attached to a live (or interrupted) crawl without rewriting
	 * the user's tmpDir.
	 * @param readOnly - When true, skip schema init + migrations.
	 */
	async #init(readOnly: boolean) {
		if (readOnly) {
			return;
		}
		await initSchema(this.#instance);
		await migrateInfoRoots(this.#instance);
		await migratePageErrors(this.#instance);
	}
	/**
	 * Upserts page data into the `pages` table (inserts if new, updates if existing).
	 * @param page
	 * @param isTarget
	 * @param trx
	 */
	async #insertPage(page: PageData, isTarget: boolean, trx?: Knex.Transaction) {
		const qb = trx ?? this.#instance;
		const pageId = await this.#getIdByUrl(page.url.withoutHashAndAuth, undefined, trx);
		await qb('pages')
			.where('id', pageId)
			.update({
				scraped: true,
				isTarget,
				isExternal: page.isExternal,
				status: page.status,
				statusText: page.statusText,
				// Canonicalize so the stored value matches the exact-string page-ness
				// predicate (`WHERE contentType = 'text/html'`) used by the read layer
				// and the case-insensitive `isHtmlContentType` used in code. Responses
				// are recorded verbatim upstream, so `Text/HTML` / `text/html ` can
				// otherwise be stored and silently misclassified.
				contentType: normalizeContentType(page.contentType),
				contentLength: page.contentLength,
				responseHeaders: JSON.stringify(page.responseHeaders),
				lang: page.meta.lang,
				title: page.meta.title,
				description: page.meta.description,
				keywords: page.meta.keywords,
				noindex: page.meta.noindex,
				nofollow: page.meta.nofollow,
				noarchive: page.meta.noarchive,
				canonical: page.meta.canonical,
				alternate: page.meta.alternate,
				og_type: page.meta['og:type'],
				og_title: page.meta['og:title'],
				og_site_name: page.meta['og:site_name'],
				og_description: page.meta['og:description'],
				og_url: page.meta['og:url'],
				og_image: page.meta['og:image'],
				twitter_card: page.meta['twitter:card'],
				isSkipped: page.isSkipped,
			});
		return pageId;
	}
	/**
	 * Points each redirect-source URL at the destination page, marking it scraped
	 * and clearing any content it owned in a former life.
	 *
	 * Shared by {@link updatePage} (which also renders and stores the destination)
	 * and {@link recordRedirect} (which only records the edge for a destination
	 * rendered elsewhere). Self-redirects (source equal to the destination) are
	 * skipped so a page is never marked as redirecting to itself — that would
	 * exclude it from reports via the `whereNull('redirectDestId')` filter.
	 * @param trx - The active transaction.
	 * @param sources - Redirect-source URLs (normalised): the original URL plus
	 *   any intermediate hops. Empty when the page was not redirected.
	 * @param destId - Database id of the redirect destination page.
	 * @param destUrlNormalized - Normalised destination URL, used to detect and
	 *   skip self-redirects.
	 * @param isExternal - Whether the sources are external to the crawl scope.
	 */
	async #linkRedirectSources(
		trx: Knex.Transaction,
		sources: readonly string[],
		destId: number,
		destUrlNormalized: string,
		isExternal: boolean,
	): Promise<void> {
		for (const redirect of sources) {
			if (redirect === destUrlNormalized) {
				dbLog('Skip self-redirect: %s', redirect);
				continue;
			}
			dbLog('Set redirected url: %s -> id:%d', redirect, destId);
			const redirectId = await this.#getIdByUrl(redirect, undefined, trx);
			await trx<DB_Page>('pages')
				.where('id', redirectId)
				.update({
					scraped: 1,
					redirectDestId: destId,
					isExternal: isExternal ? 1 : 0,
				});
			// A page that used to be scraped as content can later turn into a
			// redirect source. It owns no content anymore, so drop any anchors /
			// images it captured in its former life — otherwise they linger and
			// leak into referrer / incoming-link reads (which do not filter out
			// redirect sources).
			await trx('anchors').where('pageId', redirectId).delete();
			await trx('images').where('pageId', redirectId).delete();
		}
	}

	/**
	 * Assigns and persists the HTML snapshot file path for a page.
	 * @param pageId
	 * @param snapshotDir
	 * @param trx
	 */
	async #updateSnapshotPath(pageId: number, snapshotDir: string, trx?: Knex.Transaction) {
		const qb = trx ?? this.#instance;
		const snapshotHtmlPath = path.resolve(snapshotDir, `${pageId}.html`);
		const snapshotRelHtmlPath = path.relative(this.#workingDir, snapshotHtmlPath);
		await qb('pages').where('id', pageId).update({
			html: snapshotRelHtmlPath,
		});
		return {
			html: snapshotHtmlPath,
			pageId,
		};
	}

	/**
	 * Creates and initializes a new Database instance.
	 *
	 * **Writer mode (default)**: creates the parent directory for the
	 * database file if needed, establishes the connection, and initializes
	 * the schema + migrations.
	 *
	 * **Read-only mode** (`options.readOnly`): refuses to resurrect a
	 * missing parent directory or db file — throws if either is absent at
	 * the time of the call. Skips schema init and migrations entirely so
	 * the user's tmpDir is never modified. Required by viewer / MCP
	 * stub-mode opens, where a TOCTOU window between classification and
	 * `connect()` could otherwise leave behind a phantom empty tmpDir.
	 * @param options - Database connection options.
	 * @returns A fully initialized Database instance.
	 * @throws {Error} In read-only mode, if the parent directory or db
	 *   file does not exist when `connect()` runs.
	 */
	static async connect(options: DatabaseOption) {
		if (options.readOnly) {
			if (!existsSync(path.dirname(options.filename))) {
				throw new Error(
					`Cannot open archive read-only: parent directory disappeared (${path.dirname(options.filename)}). The source may have been removed by another process.`,
				);
			}
			if (!existsSync(options.filename)) {
				throw new Error(
					`Cannot open archive read-only: database file missing (${options.filename}). The source may have been removed by another process.`,
				);
			}
		} else {
			mkdir(options.filename);
		}
		const db = new Database(options);
		await db.#init(options.readOnly ?? false);
		return db;
	}
}
