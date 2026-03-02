import type {
	Config,
	DB_Anchor,
	DB_Page,
	DB_Redirect,
	DB_Referrer,
	DB_Resource,
	DatabaseEvent,
	PageFilter,
} from './types.js';
import type { PageData, Resource } from '../utils/index.js';
import type { RetryDecoratorOptions } from '@d-zero/shared/retry';
import type { Knex } from 'knex';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { retry } from '@d-zero/shared/retry';
import { pathComparator } from '@d-zero/shared/sort/path';
import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';
import knex from 'knex';

import { ErrorEmitter, eachSplitted } from '../utils/index.js';

import { dbLog } from './debug.js';
import { mkdir } from './filesystem/index.js';

const retrySetting: RetryDecoratorOptions = {
	interval: 300,
	retries: 3,
};

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
		switch (options.type) {
			case 'sqlite3': {
				this.#instance = knex({
					client: options.type,
					connection: {
						filename: options.filename,
					},
					useNullAsDefault: true,
					pool: {
						acquireTimeoutMillis: 600_000,
					},
				});
				break;
			}
			case 'mysql': {
				throw new Error("Don't support MySQL yet.");
			}
		}
	}

	/**
	 * Adds the `order` column to the `pages` table for URL sort ordering.
	 * @deprecated Since v0.1.x. The column is now created during table initialization.
	 * @returns The result of the schema alteration.
	 */
	async addOrderField() {
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
	 * Deserializes JSON-encoded fields (`excludes`, `excludeKeywords`, `scope`).
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
			scope: getJSON<string[]>(config.scope, []),
			retry: config.retry ?? 3,
		};
		// @ts-expect-error
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
		await this.addOrderField().catch((error) => error);
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
				contentType: resource.contentType,
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
		await this.#instance('resources-referrers').insert({
			resourceId,
			pageId,
		});
	}

	/**
	 * Stores the crawl configuration in the `info` table.
	 * Serializes array fields (`excludes`, `excludeKeywords`, `scope`) as JSON strings.
	 * @param config - The {@link Config} object to store.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async setConfig(config: Config) {
		return this.#instance.from<Config>('info').insert({
			...config,
			// @ts-expect-error
			excludes: JSON.stringify(config.excludes),
			// @ts-expect-error
			excludeKeywords: JSON.stringify(config.excludeKeywords),
			// @ts-expect-error
			excludeUrls: JSON.stringify(config.excludeUrls),
			// @ts-expect-error
			scope: JSON.stringify(config.scope),
		});
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
	 * Inserts or updates a crawled page in the database, including its redirect chain,
	 * anchors, and images. Optionally creates an HTML snapshot file path entry.
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
		let destUrl = page.url.withoutHashAndAuth;
		const redirectPaths = [...page.redirectPaths];
		if (redirectPaths.length > 0) {
			destUrl = redirectPaths.pop()!;
			redirectPaths.unshift(page.url.withoutHashAndAuth);
		}

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

			for (const redirect of redirectPaths) {
				dbLog('Set redirected url: %s -> %s', redirect, destUrl);
				const redirectId = await this.#getIdByUrl(redirect, undefined, trx);
				await trx<DB_Page>('pages')
					.where('id', redirectId)
					.update({
						scraped: 1,
						redirectDestId: pageId,
						isExternal: page.isExternal ? 1 : 0,
					});
			}
			let snapshot: { html?: string; pageId: number } = { pageId };
			if (isTarget && snapshotDir) {
				snapshot = await this.#updateSnapshotPath(pageId, snapshotDir, trx);
			}
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
	 * Initializes the database schema if tables do not exist.
	 * Enables WAL journal mode and foreign keys, then creates all tables
	 * (`info`, `pages`, `anchors`, `images`, `resources`, `resources-referrers`).
	 */
	async #init() {
		const isExists = await this.#instance.schema.hasTable('info');
		if (isExists) {
			return;
		}

		// Enable WAL mode and foreign keys for better performance and data integrity
		await this.#instance.raw('PRAGMA journal_mode = WAL');
		await this.#instance.raw('PRAGMA foreign_keys = ON');

		await this.#instance.schema
			.createTable('info', (t) => {
				t.increments('id');
				t.string('version');
				t.string('name');
				t.string('baseUrl');
				t.boolean('recursive');
				t.integer('interval');
				t.boolean('image');
				t.boolean('fetchExternal');
				t.integer('parallels');
				t.json('scope');
				t.json('excludes');
				t.json('excludeKeywords');
				t.json('excludeUrls');
				t.integer('maxExcludedDepth');
				t.integer('retry');
				t.boolean('fromList');
				t.boolean('disableQueries');
				t.string('userAgent');
				t.boolean('ignoreRobots');
			})
			.createTable('pages', (t) => {
				t.increments('id');
				t.string('url', 8190).notNullable().unique();
				t.integer('redirectDestId').unsigned().references('pages.id').defaultTo(null);
				t.boolean('scraped').notNullable();
				t.boolean('isTarget').notNullable();
				t.boolean('isExternal');
				t.integer('status');
				t.string('statusText');
				t.string('contentType').nullable();
				t.integer('contentLength').unsigned().nullable();
				t.json('responseHeaders').nullable();
				t.string('lang');
				t.string('title');
				t.string('description');
				t.string('keywords');
				t.boolean('noindex');
				t.boolean('nofollow');
				t.boolean('noarchive');
				t.string('canonical');
				t.string('alternate');
				t.string('og_type');
				t.string('og_title');
				t.string('og_site_name');
				t.string('og_description');
				t.string('og_url');
				t.string('og_image');
				t.string('twitter_card');
				t.string('html');
				t.boolean('isSkipped');
				t.string('skipReason');
				t.integer('order').unsigned().nullable();

				t.index('isExternal');
				t.index('contentType');
				t.index('scraped');
				t.index('redirectDestId');
				t.index('order');
			})
			.createTable('anchors', (t) => {
				t.increments('id');
				t.integer('pageId').notNullable().unsigned().references('pages.id');
				t.integer('hrefId').notNullable().unsigned().references('pages.id');
				t.string('hash');
				t.string('textContent').nullable();

				t.index('pageId');
				t.index('hrefId');
			})
			.createTable('images', (t) => {
				t.increments('id');
				t.integer('pageId').notNullable().unsigned().references('pages.id');
				t.string('src', 8190);
				t.string('currentSrc', 8190);
				t.string('alt');
				t.float('width').unsigned().notNullable();
				t.float('height').unsigned().notNullable();
				t.integer('naturalWidth').unsigned().notNullable();
				t.integer('naturalHeight').unsigned().notNullable();
				t.boolean('isLazy');
				t.integer('viewportWidth').unsigned().notNullable();
				t.string('sourceCode');

				t.index('pageId');
			})
			.createTable('resources', (t) => {
				t.increments('id');
				t.string('url', 8190).notNullable().unique();
				t.boolean('isExternal');
				t.integer('status');
				t.string('statusText');
				t.string('contentType').nullable();
				t.integer('contentLength').unsigned().nullable();
				t.string('compress').nullable();
				t.string('cdn').nullable();
				t.json('responseHeaders').nullable();
			})
			.createTable('resources-referrers', (t) => {
				t.increments('id');
				t.integer('resourceId').notNullable().unsigned().references('resources.id');
				t.integer('pageId').notNullable().unsigned().references('pages.id');

				t.unique(['resourceId', 'pageId']);
				t.index('resourceId');
				t.index('pageId');
			});
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
				contentType: page.contentType,
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
	 * Creates the parent directory for the database file if needed,
	 * establishes the connection, and initializes tables if they do not exist.
	 * @param options - The database connection options specifying the type and file path.
	 * @returns A fully initialized Database instance.
	 */
	static async connect(options: DatabaseOption) {
		switch (options.type) {
			case 'sqlite3': {
				mkdir(options.filename);
				break;
			}
		}
		const db = new Database(options);
		await db.#init();
		return db;
	}
}

// ----- ----- ----- ----- -----
//
// Common Queries
//
// ----- ----- ----- ----- -----

/**
 * Returns a Knex subquery builder that selects page IDs with pagination,
 * ordered by the `order` column (nulls last), excluding redirected pages.
 * @param limit - The maximum number of page IDs to return.
 * @param offset - The number of page IDs to skip before returning results.
 */
function limitedPageIds(limit: number, offset: number) {
	return async (qb: Knex.QueryBuilder<Record<string, unknown>, unknown>) => {
		await qb
			.select('id')
			.from<DB_Page>('pages')
			.orderByRaw('`order` ASC NULLS LAST')
			.whereNull('redirectDestId')
			.limit(limit)
			.offset(offset);
	};
}

/**
 * Returns a Knex subquery builder that joins pages with their redirect destinations.
 * When `includeNull` is true, also includes pages without redirects (self-referencing).
 * @param includeNull - Whether to include non-redirected pages in the result. Defaults to `true`.
 */
function redirectTable(includeNull = true) {
	return async (qb: Knex.QueryBuilder<Record<string, unknown>, unknown>) => {
		const list = qb
			.select('A.id as fromId', 'A.url as from', 'B.url as to', 'B.id as toId')
			.from('pages as A')
			.join('pages as B', (j) => {
				j.on('A.redirectDestId', '=', 'B.id').andOnNotNull('A.redirectDestId');
			});
		if (includeNull) {
			await list.union(async (qb) => {
				await qb
					.select('A.id as fromId', 'A.url as from', 'A.url as to', 'A.id as toId')
					.from('pages as A')
					.whereNull('A.redirectDestId');
			});
		}
	};
}

// ----- ----- ----- ----- -----
//
// Utils
//
// ----- ----- ----- ----- -----

/**
 * Safely parses a JSON string, returning a fallback value if parsing fails or the input is not a string.
 * @param data - The data to parse. Only string values are parsed; other types return the fallback.
 * @param fallback - The value to return if parsing fails or the result is falsy.
 * @returns The parsed JSON value, or the fallback.
 */
function getJSON<T>(data: unknown, fallback: T): T {
	try {
		if (typeof data === 'string') {
			const result = JSON.parse(data);
			if (result) {
				return result;
			}
			return fallback;
		}
	} catch {
		// void
	}

	return fallback;
}

// ----- ----- ----- ----- -----
//
// Types
//
// ----- ----- ----- ----- -----

/**
 * Base options shared by all database connection configurations.
 */
type AbsDatabaseOption = {
	/** The working directory for the database (used for resolving relative paths). */
	workingDir: string;
};

/**
 * Union type for all supported database connection options.
 */
type DatabaseOption = DatabaseSqlite3Option | DatabaseMySqlOption;

/**
 * Connection options for a SQLite3 database.
 */
type DatabaseSqlite3Option = AbsDatabaseOption & {
	/** The database type identifier. */
	type: 'sqlite3';
	/** The absolute file path to the SQLite database file. */
	filename: string;
};

/**
 * Connection options for a MySQL database.
 * Note: MySQL support is not yet implemented.
 */
type DatabaseMySqlOption = AbsDatabaseOption & {
	/** The database type identifier. */
	type: 'mysql';
};
