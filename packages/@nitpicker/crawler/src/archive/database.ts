import type { JsonLdRow, TagRow } from './meta/types.js';
import type {
	Config,
	DatabaseOption,
	DB_Anchor,
	DB_Page,
	DB_Redirect,
	DB_Referrer,
	DB_Resource,
	DatabaseEvent,
	InventoryRunMeta,
	PageFilter,
	PageSource,
} from './types.js';
import type { PageData, Resource } from '../utils/types/types.js';
import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';
import type { RetryDecoratorOptions } from '@d-zero/shared/retry';
import type { Knex } from 'knex';

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { retry } from '@d-zero/shared/retry';
import { pathComparator } from '@d-zero/shared/sort/path';
import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';
import knex from 'knex';

import { classifyErrorKind } from '../classify-error-kind.js';
import { findScopeEntry } from '../crawler/find-scope-entry.js';
import { isHtmlContentType } from '../crawler/is-html-content-type.js';
import { normalizeContentType } from '../crawler/normalize-content-type.js';
import { PERMANENT_ERROR_KINDS } from '../permanent-error-kinds.js';
import { eachSplitted } from '../utils/array/each-splitted.js';
import { ErrorEmitter } from '../utils/error/error-emitter.js';

import { dbLog } from './debug.js';
import { deriveLineageFromParent } from './derive-lineage-from-parent.js';
import { mkdir } from './filesystem/mkdir.js';
import { getFailedPageMessages } from './get-failed-page-messages.js';
import { getJSON } from './get-json.js';
import { applyConnectionPragmas, initSchema } from './init-schema.js';
import { LibsqlDialect } from './libsql-dialect.js';
import { limitedPageIds } from './limited-page-ids.js';
import { assertCompatibleVersion } from './meta/assert-compatible-version.js';
import { classifyJsonLdType } from './meta/classify-jsonld-type.js';
import { computePageDenormalized } from './meta/compute-page-denormalized.js';
import { deriveFlatFromMeta } from './meta/derive-flat-from-meta.js';
import { deriveMetaExtras } from './meta/derive-meta-extras.js';
import { extractTagsForArchive } from './meta/extract-tags-for-archive.js';
import { migrateCrawlErrors } from './migrate-crawl-errors.js';
import { migrateHtmlBlobTables } from './migrate-html-blob-tables.js';
import { migrateInfoRoots } from './migrate-info-roots.js';
import { migrateInventoryRuns } from './migrate-inventory-runs.js';
import { migratePageErrors } from './migrate-page-errors.js';
import { migratePagesResourcesSource } from './migrate-pages-resources-source.js';
import { redirectTable } from './redirect-table.js';
import { resolveRedirectChain } from './resolve-redirect-chain.js';

const retrySetting: RetryDecoratorOptions = {
	interval: 300,
	retries: 3,
};

/**
 * Decodes a stored HTML body BLOB according to its codec marker. The codec
 * column on `page_html_blobs` exists so individual rows can be migrated to
 * a future encoder without rewriting the whole table; readers must dispatch
 * on it. The body is typed `Uint8Array` (not `Buffer`) because libsql
 * returns BLOB columns as bare `Uint8Array`; `Buffer.from` wraps it
 * zero-copy.
 * @param body - Raw bytes as stored in `page_html_blobs.body`.
 * @param codec - The `codec` column value (e.g. `'zstd'`, `'none'`).
 * @returns UTF-8 decoded HTML string.
 * @throws {Error} If the codec is not recognised.
 */
/**
 * Parses a JSON column value, returning `null` on parse failure rather than
 * throwing. JSON columns in `page_jsonld` (`parsed`) and `page_tags`
 * (`categories`, `sources`) are written by `JSON.stringify` and round-trip
 * cleanly under normal conditions; a hand-edited archive that has
 * malformed JSON in those columns should degrade gracefully rather than
 * propagate a parse error up to the consumer.
 * @param value - JSON-encoded text.
 */
function safeParseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

/**
 *
 * @param body
 * @param codec
 */
function decodeStoredBlob(body: Uint8Array, codec: string): string {
	// `Buffer.from(buffer)` accepts Uint8Array, Buffer, and array-like
	// shapes uniformly; libsql may hand back any of these for a BLOB
	// column depending on the row encoding.
	const buffer = Buffer.from(body);
	if (codec === 'zstd') {
		return zstdDecompressSync(buffer).toString('utf8');
	}
	if (codec === 'none') {
		return buffer.toString('utf8');
	}
	throw new Error(`Unknown page_html_blobs.codec: ${codec}`);
}

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
 * Columns of the `pages` table that should be reset to `null` whenever a
 * previously-scraped row is demoted back to "pending" (i.e. by
 * `resetFailedPages` and `repromoteExternalPages`).
 *
 * Includes all flat meta columns, the denormalised aggregates, and the
 * `meta_extras` JSON catch-all. **Excludes** `firstCrawledAt` / `lastCrawledAt`
 * by design — failure reset must not erase the last-success timestamp, which
 * is the within-archive observation axis for #11 / #17 / #19 use cases.
 *
 * Centralised in one constant so schema growth and reset logic stay in lock-
 * step: adding a flat meta column without updating this list would leave
 * stale data after a reset.
 */
const META_NULLABLE_COLUMNS: readonly string[] = [
	// Document basics
	'lang',
	'dir',
	'charset',
	'baseHref',
	'viewport_raw',
	'themeColor',
	'applicationName',
	'author',
	'generator',
	'publisher',
	// Title / description / keywords
	'title',
	'description',
	'keywords',
	// Robots
	'robots_raw',
	'robots_noindex',
	'robots_nofollow',
	'robots_noarchive',
	'robots_noimageindex',
	'googlebot',
	// Link (1:1)
	'canonical',
	'amphtml',
	'manifest',
	'icon_href',
	'appleTouchIcon_href',
	// Open Graph
	'og_type',
	'og_title',
	'og_url',
	'og_site_name',
	'og_description',
	'og_image',
	'og_image_alt',
	'og_image_width',
	'og_image_height',
	'og_locale',
	'og_article_published_time',
	'og_article_modified_time',
	// Twitter
	'twitter_card',
	'twitter_site',
	'twitter_creator',
	'twitter_title',
	'twitter_description',
	'twitter_image',
	// One-offs
	'fb_app_id',
	'verification_google',
	'formatDetection_telephone',
	// Denormalised aggregates
	'tag_count',
	'jsonld_count',
	'tags_providers_csv',
	// Catch-all
	'meta_extras',
];

/**
 * Builds the reset payload for {@link META_NULLABLE_COLUMNS} as a plain object
 * suitable for `knex.update(...)`. All listed columns are mapped to `null`.
 */
function makeMetaResetPayload(): Record<string, null> {
	const payload: Record<string, null> = {};
	for (const col of META_NULLABLE_COLUMNS) {
		payload[col] = null;
	}
	return payload;
}

/**
 * Low-level database abstraction layer for the archive's SQLite database.
 *
 * Public methods that perform database queries use the `@retryable`
 * decorator for automatic retry on transient failures, and `@ErrorEmitter`
 * to propagate errors as events. The set of tables this layer manages is
 * defined by `init-schema.ts` (the source of truth — query that file for
 * the canonical list).
 *
 * Use the static {@link Database.connect} factory method to create instances.
 * The constructor is private.
 */
export class Database extends EventEmitter<DatabaseEvent> {
	/** The Knex query builder instance connected to the SQLite database. */
	#instance: Knex;
	// eslint-disable-next-line no-restricted-syntax
	private constructor(options: DatabaseOption) {
		super();
		// **Known caveat (libsql 0.5.x)**: passing `readonly: true` via
		// `connection.options` is accepted by the libsql driver but is
		// NOT enforced at the SQL layer — `CREATE TABLE` / `INSERT`
		// against the resulting connection still succeed. The flag
		// remains a no-op until libsql adds real read-only enforcement
		// upstream. Read-only safety in cache mode therefore relies on:
		//
		// 1. `Database.#init` skipping schema init + migrations when
		//    `readOnly` is set (so no `initSchema` / `migrate*` ever
		//    writes to the shared cache directory).
		// 2. `ArchiveAccessor.setData` rejecting writes when the
		//    `readOnly` flag is set on the accessor.
		// 3. Code review on any future internal use of
		//    `accessor.getKnex()` — there is no driver-level guard.
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
	 *
	 * `scraped` is straightforward: every page row whose `scraped` flag is `1`
	 * — that is, every URL the crawl reached a terminal state on, including
	 * setSkippedPage / setExternalPage / outright setPage success or failure.
	 *
	 * `pending` is intentionally STRICT — not "every `scraped = 0` row".
	 * Three filters apply:
	 *
	 * 1. `scraped = 0` — work still incomplete.
	 * 2. `isExternal = 0` — only in-scope work. External URLs go through a
	 *    HEAD-only path that always lands on `scraped = 1` (either setPage or
	 *    setExternalPage). A row with `isExternal = 1 AND scraped = 0` is
	 *    therefore a data anomaly, and resume / inventory / append have no
	 *    business retrying it on the next session.
	 * 3. `EXISTS (anchor with hrefId = pages.id) OR source != 'crawled'` —
	 *    the row was either discovered as an anchor destination during a
	 *    previous scrape OR was explicitly tagged with a non-default
	 *    source label (`'inventory-seed'`, `'inventory-discovered'`, …).
	 *    Both halves of the OR represent "deliberately enqueued, expected
	 *    to be processed", which is exactly what `resume` should pick up.
	 *
	 *    The orphan filter targets the **predicted-discard leak** in
	 *    `crawler.ts` where `shouldDiscardPredicted` returns true but no
	 *    `emit('skip')` follows. Such placeholders are inserted with the
	 *    DB DEFAULT `source = 'crawled'` (no caller explicitly labels
	 *    them) AND have no anchor referrer (predicted URLs are
	 *    synthesised from pagination patterns, never anchored from a
	 *    rendered page) — both halves of the OR are therefore false and
	 *    the leak is excluded.
	 *
	 *    The `source != 'crawled'` clause specifically saves the
	 *    `--inventory` × `--retry-failed` interaction: an inventory-seed
	 *    URL came from the operator's URL list (no anchor referrer) and
	 *    `resetFailedPages` puts it back at `scraped = 0`. Without this
	 *    clause those legitimate retries would be dropped on resume.
	 *
	 * The defensive shape is on purpose: the data source can drift into
	 * anomalous states under interruption, but the reader must never throw
	 * or feed garbage back into the dealer. A real in-scope URL that was
	 * truly interrupted mid-crawl will always have at least one anchor
	 * referrer (otherwise the dealer would not have queued it), so the
	 * strict filter loses no legitimate pending work.
	 *
	 * Seeds passed directly to `Crawler.start()` are NOT in the strict
	 * pending set when they were never picked by the dealer — they have no
	 * DB row at all in that case (`linkList.add` is purely in-memory until
	 * `setPage` runs). A Ctrl-C between dealer pick and `setPage` likewise
	 * leaves no row to recover. Recovery of un-picked seeds is the
	 * responsibility of the caller (e.g. re-running `--inventory ./list.txt`
	 * with the same URL list).
	 *
	 * The query uses an explicit `p` alias on the `pages` table so the
	 * correlated `EXISTS` subquery can join via `whereRaw('anchors.hrefId =
	 * p.id')`. A future refactor that renames the alias must update both
	 * sites — the raw string in the subquery cannot be grep-resolved
	 * automatically. Read-only / stub viewer connections never call this
	 * method (they do not need to know about pending state), so the EXISTS
	 * shape is safe to use without the `migrate*` guards that other writer
	 * methods carry.
	 * @returns An object with `scraped` (completed URLs) and `pending` (the
	 *   strict set of in-scope, anchor-referenced, unfinished URLs).
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
			.select('p.url')
			.from<DB_Page>({ p: 'pages' })
			.where('p.scraped', 0)
			.where('p.isExternal', 0)
			.where((qb) => {
				// "Anchored OR explicitly labelled". Either side is evidence
				// that the row was deliberately enqueued for processing —
				// only the predicted-discard leak (DEFAULT 'crawled' + no
				// anchor) fails both halves. The `whereExists` callback
				// uses `select('*')` since the column list is irrelevant
				// inside an EXISTS check; calling through `client.raw(...)`
				// would reach a private builder field.
				qb.whereExists(function () {
					this.select('*').from('anchors').whereRaw('anchors.hrefId = p.id');
				}).orWhereNot('p.source', 'crawled');
			});
		const pending = $pending.map(ex);
		return {
			scraped,
			pending,
		};
	}
	/**
	 * Return the subset of `urls` that already exist in the `pages` table.
	 * Chunked into batches so SQLite's `IN (?, ?, …)` parameter limit
	 * (`SQLITE_MAX_VARIABLE_NUMBER`, default 999) cannot be hit even when the
	 * inventory list contains tens of thousands of URLs.
	 *
	 * Read-only — no transaction, no lock contention with the crawler write
	 * pipeline (callers run this BEFORE the `<archive>.bak` is taken and the
	 * crawl is started).
	 * @param urls - URL strings to probe (already in `withoutHashAndAuth` form).
	 * @returns URLs found in `pages`. Order is not preserved.
	 */
	@ErrorEmitter()
	async getExistingPageUrls(urls: readonly string[]): Promise<string[]> {
		if (urls.length === 0) {
			return [];
		}
		const found: string[] = [];
		await eachSplitted([...urls], 500, async (chunk) => {
			const rows = await this.#instance
				.select('url')
				.from<DB_Page>('pages')
				.whereIn('url', chunk);
			for (const row of rows) {
				found.push(row.url);
			}
		});
		return found;
	}
	/**
	 * Return the subset of `urls` that already exist in the `resources` table.
	 * See {@link Database.getExistingPageUrls} — same chunking strategy.
	 * @param urls - URL strings to probe.
	 * @returns URLs found in `resources`.
	 */
	@ErrorEmitter()
	async getExistingResourceUrls(urls: readonly string[]): Promise<string[]> {
		if (urls.length === 0) {
			return [];
		}
		const found: string[] = [];
		await eachSplitted([...urls], 500, async (chunk) => {
			const rows = await this.#instance
				.select('url')
				.from<DB_Resource>('resources')
				.whereIn('url', chunk);
			for (const row of rows) {
				found.push(row.url);
			}
		});
		return found;
	}
	/**
	 * Reads the HTML snapshot stored as a zstd-compressed BLOB for the given page.
	 *
	 * Joins `page_html_ref` → `page_html_blobs` and decompresses inline. Returns
	 * `null` when the page has no stored body (a non-HTML resource, a redirect
	 * source, a degraded render). Read works identically on read-only / stub
	 * connections — the special-cased "do we have a loose dir vs zip?" branching
	 * the previous file-backed layout required is gone.
	 *
	 * Tables `page_html_ref` and `page_html_blobs` are created by `initSchema`.
	 * Older `.nitpicker` archives that predate this migration must be passed
	 * through `scripts/migrate-to-0.10.mjs` before they can be read.
	 * @param pageId - The database ID of the page.
	 * @returns The decompressed HTML string, or `null` if no snapshot is stored.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getHtmlOfPageById(pageId: number): Promise<string | null> {
		const row = await this.#instance
			.from<{ body: Uint8Array; codec: string }>('page_html_ref')
			.join('page_html_blobs', 'page_html_ref.hash', '=', 'page_html_blobs.hash')
			.select('page_html_blobs.body as body', 'page_html_blobs.codec as codec')
			.where('page_html_ref.page_id', pageId)
			.first();
		if (!row) {
			return null;
		}
		return decodeStoredBlob(row.body, row.codec);
	}
	/**
	 * Retrieves all `page_jsonld` rows for the given page id, parsed back into
	 * {@link JsonLdRow} shape (with `parsed` deserialised from its JSON column).
	 *
	 * Read-side counterpart to `#insertJsonLd`. Returns rows in insertion order
	 * by `id` so the order observed by `get-page-jsonld` matches the order the
	 * scraper saw them.
	 * @param pageId
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getJsonLdOfPage(pageId: number): Promise<JsonLdRow[]> {
		type Row = {
			id: number;
			pageId: number;
			kind: string;
			type: string | null;
			raw: string;
			parsed: string | null;
			parseError: string | null;
		};
		const rows = await this.#instance
			.select<Row[]>('id', 'pageId', 'kind', 'type', 'raw', 'parsed', 'parseError')
			.from('page_jsonld')
			.where('pageId', pageId)
			.orderBy('id', 'asc');
		return rows.map((r) => ({
			id: r.id,
			pageId: r.pageId,
			kind: r.kind === 'speculationrules' ? 'speculationrules' : 'ld+json',
			type: r.type,
			raw: r.raw,
			parsed: r.parsed === null ? null : safeParseJson(r.parsed),
			parseError: r.parseError,
		}));
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
	 * Look up the `source` column of a single page by its URL key. Used by
	 * the orchestrator's `PageSourceLookup` injection so the Crawler can
	 * resolve a parent page's lineage on `--resume` / `--retry-failed`
	 * sessions, where the in-memory `inventoryMode` is no longer
	 * available but the DB still remembers what label was last persisted.
	 *
	 * Returns `undefined` when the URL has no `pages` row (e.g. a brand-new
	 * URL that has not been seen yet) so the caller can fall through to
	 * its default behaviour without distinguishing "row absent" from "row
	 * present with NULL source" — the schema's `NOT NULL DEFAULT 'crawled'`
	 * makes a NULL value impossible in practice.
	 *
	 * Read-only — no transaction, single PK-equivalent lookup on
	 * `pages.url` (a UNIQUE column), so the cost is constant per call. The
	 * Crawler calls this at most once per page render, NOT per
	 * sub-resource, so the N+1 risk does not apply.
	 * @param url - URL key in `url.withoutHashAndAuth` form.
	 * @returns The recorded `source`, or `undefined` when no row exists.
	 */
	@ErrorEmitter()
	async getPageSourceByUrl(url: string): Promise<PageSource | undefined> {
		const [row] = await this.#instance
			.select('source')
			.from<DB_Page>('pages')
			.where('url', url);
		return row?.source;
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
	 *
	 * Incoming links are resolved **through redirects**: an anchor pointing at a
	 * redirect source (e.g. `http://x` that 301s to `https://x`) counts as a
	 * referrer of the redirect's final destination, not of the source. This keeps
	 * backlinks merged on the canonical page instead of splitting them across the
	 * `http`/`https` (or any redirect source/dest) pair. The resolution mirrors
	 * `redirectTable()` — `redirectDestId` is pre-flattened to the final
	 * destination, so `COALESCE(target.redirectDestId, target.id)` is a single hop.
	 * @param pageId - The database ID of the target page.
	 * @returns An array of referrer records with URL, hash, and text content.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getReferrersOfPage(pageId: number) {
		const res = await this.#instance
			.select(
				'referrer.url',
				// `through` / `throughId` = the URL the anchor actually pointed at (the
				// redirect source, e.g. `http://x`), mirroring `getPagesWithRels`'
				// `redirect.from` / `redirect.fromId`. Lets report code print the
				// "[REDIRECTED FROM]" note even on this (non-preloaded) referrer path.
				'target.url as through',
				'target.id as throughId',
				'anchors.hash',
				'anchors.textContent',
			)
			.from('anchors')
			.join('pages as referrer', 'anchors.pageId', '=', 'referrer.id')
			.join('pages as target', 'anchors.hrefId', '=', 'target.id')
			.whereRaw('coalesce("target"."redirectDestId", "target"."id") = ?', [pageId]);
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
	 * Retrieves all `page_tags` rows for the given page id, parsed back into
	 * {@link TagRow} shape (with `categories` and `sources` JSON columns
	 * deserialised).
	 *
	 * Read-side counterpart to `#insertTags`.
	 * @param pageId
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async getTagsOfPage(pageId: number): Promise<TagRow[]> {
		type Row = {
			id: number;
			pageId: number;
			provider: string;
			category: string | null;
			externalId: string | null;
			version: string | null;
			confidence: number | null;
			categories: string | null;
			sources: string | null;
		};
		const rows = await this.#instance
			.select<
				Row[]
			>('id', 'pageId', 'provider', 'category', 'externalId', 'version', 'confidence', 'categories', 'sources')
			.from('page_tags')
			.where('pageId', pageId)
			.orderBy('id', 'asc');
		return rows.map((r) => ({
			id: r.id,
			pageId: r.pageId,
			provider: r.provider,
			category: r.category,
			externalId: r.externalId,
			version: r.version,
			confidence: r.confidence,
			categories:
				r.categories === null ? [] : ((safeParseJson(r.categories) as string[]) ?? []),
			sources:
				r.sources === null ? [] : ((safeParseJson(r.sources) as TagRow['sources']) ?? []),
		}));
	}
	/**
	 * Pre-insert inventory non-HTML URLs into `resources` as placeholder rows
	 * with `source = 'inventory-seed'` and all metadata columns NULL — the
	 * non-HTML counterpart of {@link Database.insertInventorySeeds}. Used by
	 * `CrawlerOrchestrator.inventory` so the ingestion phase commits all of
	 * its non-HTML URLs in one chunked round-trip per 500 instead of N
	 * sequential `insertResource` awaits. On a 50k-URL inventory list the
	 * old per-URL loop spent minutes inside the `.bak`-protected window;
	 * the bulk path finishes in seconds.
	 *
	 * Idempotent: `onConflict('url').ignore()` leaves existing rows untouched
	 * (the orchestrator's `getExistingResourceUrls` filter is what keeps a
	 * crawled-lineage `resources` row from being downgraded to the
	 * inventory label here).
	 *
	 * Chunked at 500 to stay well under SQLite's `SQLITE_MAX_VARIABLE_NUMBER`
	 * (default 999) — every row binds the URL plus the `responseHeaders`
	 * JSON null, so the per-chunk bound budget is well within limits.
	 * @param urls - URL strings (already in `withoutHashAndAuth` form).
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async insertInventoryResources(urls: readonly string[]): Promise<void> {
		if (urls.length === 0) {
			return;
		}
		await eachSplitted([...urls], 500, async (chunk) => {
			await this.#instance<DB_Resource>('resources')
				.insert(
					chunk.map((url) => ({
						url,
						isExternal: 0 as const,
						status: null,
						statusText: null,
						contentType: null,
						contentLength: null,
						compress: 0 as const,
						cdn: 0 as const,
						responseHeaders: null,
						source: 'inventory-seed' as PageSource,
					})),
				)
				.onConflict('url')
				.ignore();
		});
	}

	/**
	 * Pre-insert inventory HTML seeds into `pages` as `scraped = 0`,
	 * `source = 'inventory-seed'` placeholders so the URL's existence in the
	 * archive is **durable before the scrape phase starts**.
	 *
	 * Why this is the linchpin of `--inventory` Ctrl+C tolerance: HTML seeds
	 * used to live only in the Crawler's in-memory `LinkList` until the
	 * dealer eventually called `setPage`. A Ctrl+C / crash before that point
	 * lost the seed without trace, and `--resume` could not recover it
	 * because `getCrawlingState`'s strict pending set requires a `pages` row.
	 * Pre-inserting fills exactly that gap: the strict pending set picks
	 * these rows up via its `OR p.source != 'crawled'` clause, so
	 * `--resume` after an interrupted inventory pass picks every seed back
	 * up. See {@link Database.getCrawlingState} for the strict-set rationale.
	 *
	 * Idempotent: `onConflict('url').ignore()` keeps existing rows intact.
	 * The {@link Database.#getIdByUrl} crawled-wins downgrade still fires
	 * later when a crawled-lineage anchor reaches one of these seeds —
	 * that's the right behaviour (a seed that turned out to be reachable
	 * is not an orphan and should not retain the inventory label).
	 *
	 * Chunked into 500-URL batches so SQLite's bound-parameter limit
	 * (`SQLITE_MAX_VARIABLE_NUMBER`, default 999) cannot be hit even on a
	 * tens-of-thousands inventory list.
	 *
	 * Called by {@link CrawlerOrchestrator.inventory} during the
	 * `.bak`-protected ingestion phase, so any failure here aborts the run
	 * and restores from backup — the operator reruns from scratch.
	 * @param urls - URL strings already in `withoutHashAndAuth` form.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async insertInventorySeeds(urls: readonly string[]): Promise<void> {
		if (urls.length === 0) {
			return;
		}
		await eachSplitted([...urls], 500, async (chunk) => {
			await this.#instance<DB_Page>('pages')
				.insert(
					chunk.map((url) => ({
						url,
						scraped: 0 as const,
						isExternal: 0 as const,
						isTarget: 0 as const,
						source: 'inventory-seed' as PageSource,
					})),
				)
				.onConflict('url')
				.ignore();
		});
	}

	/**
	 * Records a crawler-level (`error` channel) failure into `crawl_errors`.
	 *
	 * Unlike {@link insertPageError} this is not tied to a scraped page: `url`
	 * may be an external link that never became a page row, or `null` for a
	 * process-level error. The cause is intentionally not stored — it is derived
	 * on read so that older archives (which only have `error.log`) and freshly
	 * captured rows classify identically.
	 * @param url - The URL the error is about, or `null` for a process-level error.
	 * @param message - The error message (one line is enough for classification).
	 * @param isExternal - Whether the URL is external to the crawl scope.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async insertCrawlError(url: string | null, message: string, isExternal = false) {
		await this.#instance('crawl_errors').insert({
			url,
			isExternal: isExternal ? 1 : 0,
			message,
			createdAt: Date.now(),
		});
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
	 *
	 * The `source` provenance label is written ONLY on insert; an
	 * `ON CONFLICT IGNORE` collision leaves an existing row's source untouched
	 * (this is what makes a second `crawl --inventory` non-destructive — see
	 * the inventory plan).
	 * @param resource - The resource data to insert.
	 * @param source - Provenance label for new rows. `undefined` leaves the DB DEFAULT (`'crawled'`).
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async insertResource(resource: Resource, source?: PageSource) {
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
				...(source === undefined ? {} : { source }),
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
	 * Hostnames whose `crawl_errors` history is consistently DNS failures and
	 * for which no recent 2xx-3xx page or resource is recorded — i.e. hosts
	 * the previous crawl already proved unreachable. Returned in lower-cased
	 * form. Used by `CrawlerOrchestrator.#preloadDnsBurnedHostCache` so the
	 * next session short-circuits HEAD pre-flight on these hosts.
	 *
	 * Implementation: a coarse `LIKE` filter over `crawl_errors.message`
	 * narrows the row set, then `classifyErrorKind` confirms `'dns'` in JS
	 * (the regex is the single truth source — DB-side filters never narrow
	 * it). Exclusion bags are built from a single `pages` and a single
	 * `resources` scan: any host with a 2xx-3xx page, a 2xx-3xx resource, or
	 * a `pages.lastCrawledAt` newer than its latest DNS error is dropped
	 * (the host probably recovered between the failure and the last crawl).
	 *
	 * Returns `[]` on legacy archives that pre-date the `crawl_errors`
	 * table — the `hasTable` guard keeps the call non-destructive.
	 * @returns Lower-cased hostnames safe to short-circuit.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async listDnsBurnedHostCandidates(): Promise<string[]> {
		const hasCrawlErrors = await this.#instance.schema.hasTable('crawl_errors');
		if (!hasCrawlErrors) {
			return [];
		}

		// Coarse SQL filter: cheap LIKE OR-chain over `message`. The dns regex
		// truth source lives in `classifyErrorKind`, so we only need to feed it
		// rows that COULD match a DNS token. Each LIKE is anchored on a known
		// substring of the regex so future additions to the regex (without
		// matching new SQL terms) widen the JS-side filter only — never narrow it.
		//
		// `%EAI_AGAIN%` is deliberately NOT in the SQL filter: it now classifies
		// as `dns-transient` (local resolver hiccup), not `dns`, so it must not
		// reach this candidate set. The `%getaddrinfo%` term still pulls
		// `getaddrinfo EAI_AGAIN ...` rows but the JS-side `classifyErrorKind`
		// check (first-match-wins) routes them to `dns-transient` and they
		// silently drop out — keeping the cache focused on real NXDOMAIN.
		const dnsLikeRows = (await this.#instance('crawl_errors')
			.select('url', 'message', 'createdAt')
			.whereNotNull('url')
			.where((qb) => {
				qb.where('message', 'like', '%ENOTFOUND%')
					.orWhere('message', 'like', '%getaddrinfo%')
					.orWhere('message', 'like', '%ERR_NAME_NOT_RESOLVED%')
					.orWhere('message', 'like', '%ERR_NAME_RESOLUTION_FAILED%');
			})) as { url: string; message: string; createdAt: number }[];

		if (dnsLikeRows.length === 0) {
			return [];
		}

		// Map<hostname, latestErrorCreatedAt> for hosts whose error message
		// confidently classifies as DNS (LIKE matched but classifyErrorKind says
		// e.g. `unknown` → drop).
		const candidateLatestErrorAt = new Map<string, number>();
		for (const row of dnsLikeRows) {
			if (classifyErrorKind(row.message) !== 'dns') {
				continue;
			}
			let host: string;
			try {
				host = new URL(row.url).hostname.toLowerCase();
			} catch {
				continue;
			}
			if (!host) {
				continue;
			}
			const createdAt = typeof row.createdAt === 'number' ? row.createdAt : 0;
			const previous = candidateLatestErrorAt.get(host) ?? 0;
			if (createdAt > previous) {
				candidateLatestErrorAt.set(host, createdAt);
			}
		}

		if (candidateLatestErrorAt.size === 0) {
			return [];
		}

		// Exclusion-bag #1: pages with a 2xx-3xx status anywhere on the host.
		// Tracking the latest `lastCrawledAt` per host lets us additionally
		// drop hosts whose last successful contact post-dates the most recent
		// DNS error (the host probably came back after a transient outage).
		const pageOkRows = (await this.#instance('pages')
			.select('url', 'lastCrawledAt')
			.whereBetween('status', [200, 399])) as {
			url: string;
			lastCrawledAt: number | null;
		}[];
		const pageOkHosts = new Set<string>();
		const latestPageOkAt = new Map<string, number>();
		for (const row of pageOkRows) {
			let host: string;
			try {
				host = new URL(row.url).hostname.toLowerCase();
			} catch {
				continue;
			}
			pageOkHosts.add(host);
			if (typeof row.lastCrawledAt === 'number') {
				const previous = latestPageOkAt.get(host) ?? 0;
				if (row.lastCrawledAt > previous) {
					latestPageOkAt.set(host, row.lastCrawledAt);
				}
			}
		}

		// Exclusion-bag #2: non-HTML resources with a 2xx-3xx status. resources
		// have no timestamp column so this is presence-only.
		const resourceOkRows = (await this.#instance('resources')
			.select('url')
			.whereBetween('status', [200, 399])) as { url: string }[];
		const resourceOkHosts = new Set<string>();
		for (const row of resourceOkRows) {
			let host: string;
			try {
				host = new URL(row.url).hostname.toLowerCase();
			} catch {
				continue;
			}
			resourceOkHosts.add(host);
		}

		// A candidate host is burned only if neither pages nor resources hold a
		// 2xx-3xx for it, AND its latest 2xx page (if any) is not newer than
		// the latest DNS error. The third check guards against re-burning a
		// host that recovered between the last DNS failure and the most recent
		// crawl.
		const burned: string[] = [];
		for (const [host, latestErrorAt] of candidateLatestErrorAt) {
			if (pageOkHosts.has(host)) {
				continue;
			}
			if (resourceOkHosts.has(host)) {
				continue;
			}
			const latestOkAt = latestPageOkAt.get(host);
			if (typeof latestOkAt === 'number' && latestOkAt > latestErrorAt) {
				continue;
			}
			burned.push(host);
		}
		return burned;
	}
	/**
	 * Appends one row to the `inventory_runs` audit log.
	 *
	 * Called by {@link CrawlerOrchestrator.inventory} on every successful
	 * `--inventory <list>` invocation so the archive carries a durable
	 * record of which deploy list was applied when and at what scale —
	 * the operational question "did we apply last month's list" the
	 * archive itself can answer without consulting external bookkeeping.
	 *
	 * Append-only at Phase 1. There is intentionally no UPDATE path and
	 * no UNIQUE constraint on `source_file_sha256`; two applies of the
	 * same list each get their own row, and `Phase 3 --refresh` is where
	 * dedupe / pre-flight against the hash will land. Field-level NULL
	 * semantics live on {@link InventoryRunMeta}.
	 * @param meta - The run metadata to record. Only `ran_at` is required.
	 * @returns The autoincremented `id` of the newly-inserted row.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async recordInventoryRun(meta: InventoryRunMeta): Promise<number> {
		const inserted = await this.#instance
			.from('inventory_runs')
			.insert({
				ran_at: meta.ran_at,
				list_label: meta.list_label ?? null,
				source_file_sha256: meta.source_file_sha256 ?? null,
				total_lines: meta.total_lines ?? null,
				new_pages: meta.new_pages ?? null,
				new_resources: meta.new_resources ?? null,
				scope_skipped: meta.scope_skipped ?? null,
				notes: meta.notes ?? null,
			})
			.returning('id');
		const id = inserted[0]?.id;
		if (typeof id !== 'number') {
			throw new TypeError('recordInventoryRun: INSERT returned no row id');
		}
		return id;
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
	 * @param source - Inventory provenance forwarded by the orchestrator
	 *   (`Archive.setRedirect` → here) for the redirect-edge fast path. Used
	 *   as the fallback when the originating URL's row does NOT yet exist in
	 *   the archive (`#73` convergence on first sight, js-redirect rescue
	 *   before any prior write). When the originating row already exists
	 *   (e.g. anchor-lineage INSERT from a prior pass), its stored `source`
	 *   takes precedence so transitive lineage is preserved across resume /
	 *   retry-failed sessions. `undefined` keeps the DB DEFAULT `'crawled'`
	 *   on a brand-new destination row.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async recordRedirect(page: PageData, source?: PageSource): Promise<void> {
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
			// Pass the caller-supplied `source` straight through so a
			// brand-new destination row INSERTed here picks up the
			// inventory lineage (instead of the DB DEFAULT `'crawled'`)
			// when the caller is in the inventory chain — closes the
			// hole where `recordRedirect` was previously laundering
			// inventory lineage to `'crawled'` for js-redirect rescue /
			// #73 convergence destinations that had not yet been
			// rendered.
			const destId = await this.#getIdByUrl(
				destUrlObject.withoutHashAndAuth,
				undefined,
				trx,
				source,
			);
			// Chain lineage propagates FROM the originating URL
			// (`page.url`), NOT from the destination. The originating
			// URL is what initiated the redirect chain, so its lineage
			// is what every intermediate hop transitively inherits.
			// Reading from the destination would mis-propagate in
			// "inventory-seed → ... → existing crawled dest" chains:
			// the intermediates are reached only via the inventory
			// chain, so they belong to the inventory chain even though
			// the chain happens to land on a crawled URL. The
			// `'crawled'` fallback arms the crawled-wins downgrade for
			// existing `'inventory-*'` intermediates that a crawled
			// chain reaches.
			const [originatingRow] = await trx
				.select('source')
				.from<DB_Page>('pages')
				.where('url', page.url.withoutHashAndAuth);
			const originatingSource = originatingRow?.source ?? source;
			const chainLineageSource = deriveLineageFromParent(originatingSource, 'crawled');
			await this.#linkRedirectSources(
				trx,
				sources,
				destId,
				destUrlObject.withoutHashAndAuth,
				page.isExternal,
				chainLineageSource,
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
		const metaReset = makeMetaResetPayload();
		for (let i = 0; i < promotedIds.length; i += chunkSize) {
			const chunk = promotedIds.slice(i, i + chunkSize);
			await this.#instance<DB_Page>('pages')
				.whereIn('id', chunk)
				.update({
					scraped: 0,
					isExternal: 0,
					isSkipped: 0,
					skipReason: null,
					status: null,
					statusText: null,
					contentType: null,
					contentLength: null,
					responseHeaders: '{}',
					redirectDestId: null,
					// Null every flat meta column + denormalised aggregates +
					// meta_extras. `firstCrawledAt` / `lastCrawledAt` are
					// deliberately omitted from META_NULLABLE_COLUMNS — the
					// last-success timestamp survives the demotion.
					...metaReset,
				});
			// Clear the prior crawl's data for the repromoted pages. `updatePage`
			// also replaces anchors/images/tags/jsonld when it re-scrapes them, but
			// only when the new scrape is non-empty — so this pre-clear is still
			// load-bearing for pages that get repromoted but then re-scrape to
			// nothing (or are never reached again), and it is the only place
			// `resources-referrers` is cleared. The HTML body ref is also cleared
			// so a repromoted page whose re-scrape ends up degraded does not keep
			// its old external-render snapshot. `page_tags` / `page_jsonld` are
			// cleared explicitly even though both tables also carry ON DELETE
			// CASCADE — we keep the existing pattern of explicit chunked DELETEs
			// rather than relying on CASCADE indirectly (and would not cascade
			// anyway: the parent `pages` row is updated, not deleted). Orphan
			// blobs in `page_html_blobs` are left behind; #23 will add GC.
			await this.#instance('anchors').whereIn('pageId', chunk).delete();
			await this.#instance('images').whereIn('pageId', chunk).delete();
			await this.#instance('resources-referrers').whereIn('pageId', chunk).delete();
			await this.#instance('page_html_ref').whereIn('page_id', chunk).delete();
			await this.#instance('page_tags').whereIn('pageId', chunk).delete();
			await this.#instance('page_jsonld').whereIn('pageId', chunk).delete();
		}
		dbLog('Repromoted %d external pages back to pending', promotedUrls.length);
		return promotedUrls;
	}

	/**
	 * Reset previously-attempted pages that ended in a recoverable failure so a
	 * follow-up crawl can re-fetch them from scratch.
	 *
	 * A page qualifies as a recoverable failure when it was already scraped
	 * (`scraped = 1`), is not a redirect source (`redirectDestId IS NULL`), was
	 * not intentionally skipped (`isSkipped` is not `1`), and one of the
	 * following holds:
	 *
	 * - `status = -1` — the sentinel a hard scrape failure (network error,
	 *   timeout, browser crash) is recorded with (see `handle-scrape-error.ts`);
	 * - `status IS NULL` — no status was ever stored for the row;
	 * - `contentType IS NULL` — the content type could not be determined;
	 * - `status` is in the `5xx` range — a (frequently transient) server error.
	 *
	 * Definitive `4xx` responses are intentionally excluded: re-fetching a 404
	 * almost always yields the same answer.
	 *
	 * A second exclusion runs in JS after the SQL candidate scan: any page whose
	 * latest recorded `page_errors` / `crawl_errors` message classifies into a
	 * permanent {@link PERMANENT_ERROR_KINDS} kind (dns / tls / client-blocked /
	 * parse-error / connection-refused) is left as-is rather than reset to
	 * pending. Without this filter, `--retry-failed` never converges: NXDOMAIN
	 * hosts, expired-cert hosts, and `ERR_BLOCKED_BY_CLIENT` ad pixels would be
	 * reset every iteration, re-attempted, fail identically, and rejoin the
	 * candidate pool for the next iteration. The exclusion keeps the retry
	 * target shrinking across `--retry-failed` passes by leaving deterministic
	 * dead-ends alone.
	 *
	 * Matching rows — internal and external alike — are demoted back to pending
	 * (`scraped = 0`) and have their stale scrape metadata cleared. The page row
	 * itself is kept (id preserved) so existing `anchors.hrefId` referrers stay
	 * valid, and `isExternal` is left untouched so the next pass re-classifies
	 * each page from the crawl scope. Related `anchors`, `images`,
	 * `resources-referrers`, and `page_errors` rows are deleted so the re-scrape
	 * can re-insert fresh data without duplicates.
	 *
	 * SELECT and UPDATE/DELETE statements are chunked to stay below SQLite's
	 * `SQLITE_LIMIT_VARIABLE_NUMBER`.
	 * @returns The URLs of the pages that were reset to pending.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async resetFailedPages(): Promise<string[]> {
		const candidates = await this.#instance
			.select('id', 'url')
			.from<DB_Page>('pages')
			.where('scraped', 1)
			.whereNull('redirectDestId')
			.where((qb) => {
				qb.where('isSkipped', 0).orWhereNull('isSkipped');
			})
			.where((qb) => {
				qb.whereNull('status')
					.orWhere('status', -1)
					.orWhereNull('contentType')
					.orWhereBetween('status', [500, 599]);
			});

		if (candidates.length === 0) {
			return [];
		}

		const candidateIds = candidates.map((row) => row.id);
		const candidateUrls = candidates.map((row) => row.url);
		const messages = await getFailedPageMessages(
			this.#instance,
			candidateIds,
			candidateUrls,
		);
		// Drop candidates whose latest recorded message classifies as permanent.
		// An empty/absent message stays in the retry pool — we keep retrying when
		// we don't know it's permanent, erring on the side of investigation.
		const retryable = candidates.filter((row) => {
			const message = messages.get(row.id) ?? '';
			if (message === '') {
				return true;
			}
			return !PERMANENT_ERROR_KINDS.has(classifyErrorKind(message));
		});
		const excludedCount = candidates.length - retryable.length;
		if (excludedCount > 0) {
			dbLog(
				'Excluded %d page(s) from retry — permanent failure kinds (dns/tls/client-blocked/parse-error/connection-refused)',
				excludedCount,
			);
		}
		if (retryable.length === 0) {
			return [];
		}

		const ids = retryable.map((row) => row.id);
		const urls = retryable.map((row) => row.url);

		const chunkSize = 500;
		const metaReset = makeMetaResetPayload();
		for (let i = 0; i < ids.length; i += chunkSize) {
			const chunk = ids.slice(i, i + chunkSize);
			await this.#instance<DB_Page>('pages')
				.whereIn('id', chunk)
				.update({
					scraped: 0,
					status: null,
					statusText: null,
					contentType: null,
					contentLength: null,
					responseHeaders: '{}',
					// Null every flat meta column + denormalised aggregates +
					// meta_extras. `firstCrawledAt` / `lastCrawledAt` are
					// deliberately omitted from META_NULLABLE_COLUMNS so the
					// last-success timestamp records survive the demotion (the
					// within-archive observation axis for #11/#17/#19).
					...metaReset,
				});
			// Clear the prior crawl's per-page data so the re-scrape starts clean.
			// `updatePage` only replaces anchors/images/tags/jsonld when the new
			// scrape is non-empty, so this pre-clear is load-bearing for pages that
			// reset but then fail again (or are never reached), and it is the only
			// place `resources-referrers` and `page_errors` are cleared. The HTML
			// body ref is also cleared so a previously-rendered page that now fails
			// to re-scrape does not keep its old snapshot.
			await this.#instance('anchors').whereIn('pageId', chunk).delete();
			await this.#instance('images').whereIn('pageId', chunk).delete();
			await this.#instance('resources-referrers').whereIn('pageId', chunk).delete();
			await this.#instance('page_errors').whereIn('pageId', chunk).delete();
			await this.#instance('page_html_ref').whereIn('page_id', chunk).delete();
			await this.#instance('page_tags').whereIn('pageId', chunk).delete();
			await this.#instance('page_jsonld').whereIn('pageId', chunk).delete();
		}
		dbLog('Reset %d failed pages back to pending', urls.length);
		return urls;
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
	 * anchors, images, and (when `writeHtml`) its compressed HTML snapshot BLOB.
	 *
	 * Self-redirects (where the source URL equals the destination URL after normalization)
	 * are skipped to avoid marking a page as redirected to itself — a situation caused by
	 * authentication challenges (e.g. Basic Auth 302) that would otherwise exclude the page
	 * from reports via the `whereNull('redirectDestId')` filter.
	 * @param page - The page data to store.
	 * @param writeHtml - When `true`, this call is allowed to insert (or clear)
	 *   the page's HTML blob. `setExternalPage` passes `false` because external
	 *   metadata-only scrapes never carry HTML and must not perturb an already
	 *   stored body.
	 * @param isTarget - Whether this page is a crawl target.
	 * @param source - Provenance label written ONLY when the row is freshly
	 *   inserted. Existing rows keep their original `source` (this is why a
	 *   second `crawl --inventory` does not "demote" an `'inventory-seed'` row
	 *   that was discovered earlier).
	 * @returns The database `pageId` of the inserted/updated row.
	 */
	@ErrorEmitter()
	@retry(retrySetting)
	async updatePage(
		page: PageData,
		writeHtml: boolean,
		isTarget: boolean,
		source?: PageSource,
	): Promise<number> {
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
				source,
			);

			// Wappalyzer tag detection is HTML-body independent (relies on
			// `<script src>` / `<iframe src>` / window globals / response
			// headers) so it runs for every page including external /
			// metadata-only. JSON-LD on the other hand lives inside the
			// rendered HTML body, so we only write it when there is HTML to
			// scrape — see the same `writeHtml` gate as `#writePageHtmlBlob`
			// below.
			await this.#insertTags(pageId, page.meta, trx);
			if (writeHtml) {
				await this.#insertJsonLd(pageId, page.meta, trx);
			}

			// Chain lineage propagates FROM the originating URL
			// (`page.url`), NOT from the destination. See the matching
			// rationale in `recordRedirect` above: intermediates are
			// reached transitively from the originating URL's render,
			// so they inherit its lineage. The `source` argument is the
			// authoritative origin label when inventoryMode is live;
			// fall through to a DB lookup of `page.url` for the resume
			// / retry-failed path where the call-site has no source.
			let originatingSource: PageSource | undefined = source;
			if (originatingSource === undefined) {
				const [originatingRow] = await trx
					.select('source')
					.from<DB_Page>('pages')
					.where('url', page.url.withoutHashAndAuth);
				originatingSource = originatingRow?.source;
			}
			const chainLineageSource = deriveLineageFromParent(originatingSource, 'crawled');
			await this.#linkRedirectSources(
				trx,
				sources,
				pageId,
				destUrlObject.withoutHashAndAuth,
				page.isExternal,
				chainLineageSource,
			);
			// Only insert a snapshot blob when there is actual HTML to write.
			// `page.html.length > 0` is the precise signal: the scraper returns
			// `html: ''` for everything that is not a rendered `text/html` document
			// (non-HTML responses, metadata-only, external, degraded renders), so a
			// non-empty `html` is exactly "a rendered HTML body exists". Gating on
			// `isTarget` alone would store an empty body for every internal non-HTML
			// resource — PDF / zip / images are isTarget=1 (#72).
			//
			// `isTarget` is intentionally NOT part of this condition: it is implied by
			// `html.length > 0` (only in-scope target pages are browser-rendered into a
			// non-empty body; metadata-only and external pages carry `html: ''`), so the
			// content check alone expresses the intent without a redundant term.
			if (writeHtml && page.html.length > 0) {
				await this.#writePageHtmlBlob(pageId, page.html, trx);
			} else if (
				writeHtml &&
				page.contentType !== null &&
				!isHtmlContentType(page.contentType)
			) {
				// The page is now a *known* non-HTML type. If a previous scrape stored
				// an HTML body for this URL (e.g. it served HTML then was replaced by
				// a PDF across `crawl --resume` / `--append`), drop the stale ref so
				// `page_html_ref` never contradicts `contentType`. A degraded HTML
				// re-scrape (text/html or unknown content type with empty html) is NOT
				// cleared — the last good snapshot is preserved, mirroring the
				// anchors / images empty-guard below. Gated on `writeHtml` because a
				// stale ref can only have been written by a snapshot-capable call
				// (`setPage`); `setExternalPage` passes `writeHtml = false` and never
				// sets `html`, so it has nothing to clear.
				await trx('page_html_ref').where('page_id', pageId).delete();
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
			// Lineage propagation: read the current page's merged source
			// (post-UPDATE by `#insertPage`) so anchor placeholder rows
			// inherit a label that reflects the parent's chain. A
			// `'crawled'`-lineage parent passes `'crawled'` explicitly so the
			// crawled-wins downgrade in `#getIdByUrl` fires when an anchor
			// hits an existing `'inventory-*'` row. An inventory-lineage
			// parent passes `'inventory-discovered'` to label transitively-
			// reached URLs correctly without the orchestrator needing to
			// rehydrate `inventoryMode` from disk.
			//
			// Cost: one extra SELECT on `pages` per scraped page (the
			// `id` is a PK index lookup so it is sub-millisecond even at
			// 1M-row scale). The alternative — passing `mergedSource`
			// through from the UPDATE result — would require RETURNING
			// support that knex's SQLite dialect handles inconsistently;
			// the small per-page round-trip is the cheaper trade.
			const [parentRow] = await trx
				.select('source')
				.from<DB_Page>('pages')
				.where('id', pageId);
			// `deriveLineageFromParent` collapses the three call sites
			// (anchor / redirect intermediate × updatePage / recordRedirect)
			// onto the same rule. `'crawled'` fallback (vs `undefined`)
			// arms the crawled-wins downgrade in `#getIdByUrl` for
			// existing `'inventory-*'` rows reached from a crawled
			// parent — see `isInventorySource` for the membership rule.
			const anchorLineageSource = deriveLineageFromParent(parentRow?.source, 'crawled');
			const anchors = await Promise.all(
				page.anchorList.map(async (anchor) => {
					const hrefId = await this.#getIdByUrl(
						anchor.href.withoutHashAndAuth,
						anchor.isExternal ? 1 : 0,
						trx,
						anchorLineageSource,
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
			return pageId;
		});
	}

	/**
	 * Returns the database ID for a URL, creating a new page row if needed.
	 * Uses `ON CONFLICT IGNORE` to handle race conditions in concurrent inserts.
	 *
	 * `source` is written ONLY on the INSERT path — when the row already
	 * exists, we never reach the INSERT and the existing row's `source`
	 * stays untouched. This is what keeps a second `crawl --inventory` from
	 * "demoting" a page that was first labelled `'inventory-seed'` back to
	 * `'inventory-discovered'` on later passes.
	 * @param url
	 * @param isExternal
	 * @param trx
	 * @param source - Provenance label to put on the newly-inserted row. `undefined` lets the DB DEFAULT (`'crawled'`) apply.
	 */
	async #getIdByUrl(
		url: string,
		isExternal?: 0 | 1,
		trx?: Knex.Transaction,
		source?: PageSource,
	) {
		const qb = trx ?? this.#instance;
		const [record] = await qb
			.select('id', 'source')
			.from<DB_Page>('pages')
			.where('url', url);
		// Must use `?` because it may be `undefined`
		const pageId = record?.id ?? Number.NaN;
		if (Number.isFinite(pageId)) {
			// Crawled-wins downgrade: when a row that was previously labelled
			// `'inventory-seed'` or `'inventory-discovered'` is re-encountered
			// via a `'crawled'`-lineage anchor (the parent page is part of the
			// graph reachable from the original crawl roots), downgrade it to
			// `'crawled'`. The inventory goal is finding orphans — anything
			// reachable from the crawled chain is NOT an orphan and should
			// not retain an inventory label.
			if (source === 'crawled' && record?.source && record.source !== 'crawled') {
				await qb<DB_Page>('pages').where('id', pageId).update({ source: 'crawled' });
			}
			return pageId;
		}
		const insertedRows = await qb<DB_Page>('pages')
			.insert({
				url,
				scraped: 0,
				isTarget: 0,
				...(isExternal != null && { isExternal }),
				...(source === undefined ? {} : { source }),
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
		// Connection-level PRAGMAs (foreign_keys, mmap_size, …) must be
		// reapplied on every connect — they are not persisted across opens.
		// They are safe in read-only mode because they don't write to the
		// user's tmpDir, just configure the libsql connection.
		await applyConnectionPragmas(this.#instance);
		// Reject pre-0.10 archives before any further work. Runs for both
		// writer and read-only (stub viewer) connections so old
		// `._nitpicker-*` stubs surface a clear error instead of
		// dereferencing missing columns at query time. New archives (no
		// `info` table yet) pass through; the schema is filled in by
		// `initSchema` below.
		await assertCompatibleVersion(this.#instance);
		if (readOnly) {
			return;
		}
		await initSchema(this.#instance);
		await migrateInfoRoots(this.#instance);
		await migratePageErrors(this.#instance);
		await migrateCrawlErrors(this.#instance);
		await migrateHtmlBlobTables(this.#instance);
		await migratePagesResourcesSource(this.#instance);
		await migrateInventoryRuns(this.#instance);
	}
	/**
	 * Replaces the page's JSON-LD / SpeculationRules rows with the freshly
	 * captured set. Called inside `updatePage`'s transaction.
	 *
	 * `writeHtml = false` branches (`setExternalPage`, metadata-only) skip
	 * this entirely — JSON-LD lives inside the HTML body, so external pages
	 * that are not rendered have no entries to write. An empty array on a
	 * normally-rendered page is treated as a degraded re-scrape: prior rows
	 * are kept (same `delete-only-when-replacing` invariant as `anchors` /
	 * `images`).
	 * @param pageId
	 * @param meta
	 * @param trx
	 */
	async #insertJsonLd(
		pageId: number,
		meta: PageData['meta'],
		trx: Knex.Transaction,
	): Promise<void> {
		// `??` guards tolerate the legacy "minimal meta" shape from older test
		// fixtures. Real beholder 3.0.0 always populates these required fields.
		const jsonLd = meta.jsonLd ?? [];
		const speculationRules = meta.speculationRules ?? [];
		const rows: Array<{
			pageId: number;
			kind: 'ld+json' | 'speculationrules';
			type: string | null;
			raw: string;
			parsed: string | null;
			parseError: string | null;
		}> = [];
		for (const entry of jsonLd) {
			rows.push({
				pageId,
				kind: 'ld+json',
				type: classifyJsonLdType(entry),
				raw: entry.raw,
				parsed: entry.parsed === undefined ? null : JSON.stringify(entry.parsed),
				parseError: entry.parseError ?? null,
			});
		}
		for (const entry of speculationRules) {
			rows.push({
				pageId,
				kind: 'speculationrules',
				type: classifyJsonLdType(entry),
				raw: entry.raw,
				parsed: entry.parsed === undefined ? null : JSON.stringify(entry.parsed),
				parseError: entry.parseError ?? null,
			});
		}
		if (rows.length === 0) return;
		await trx('page_jsonld').where('pageId', pageId).delete();
		await eachSplitted(rows, 100, async (chunk) => {
			await trx('page_jsonld').insert(chunk);
		});
	}
	/**
	 * Upserts page data into the `pages` table (inserts if new, updates if existing).
	 *
	 * `source` is intentionally NOT in the UPDATE clause — provenance is set
	 * once at INSERT time inside `#getIdByUrl`, and existing rows keep
	 * whatever label they were first inserted with.
	 * @param page
	 * @param isTarget
	 * @param trx
	 * @param source - Inventory provenance for the INSERT path. Ignored on UPDATE.
	 */
	async #insertPage(
		page: PageData,
		isTarget: boolean,
		trx?: Knex.Transaction,
		source?: PageSource,
	) {
		const qb = trx ?? this.#instance;
		const pageId = await this.#getIdByUrl(
			page.url.withoutHashAndAuth,
			undefined,
			trx,
			source,
		);
		const flat = deriveFlatFromMeta(page.meta, page.url.href);
		const denorm = computePageDenormalized(page.meta);
		const extras = deriveMetaExtras(page.meta);
		const now = Date.now();
		// Source priority on UPDATE: 'crawled' > 'inventory-seed' >
		// 'inventory-discovered'. The inventory feature exists to surface
		// orphans (= URLs NOT reachable from the original crawl roots).
		// Anything reachable via the crawled chain is therefore NOT an
		// orphan and must be labelled `'crawled'`, even if previously
		// labelled `'inventory-*'`. Within the inventory variants, the
		// explicit user-listed `'inventory-seed'` wins over the transitive
		// `'inventory-discovered'`.
		//
		// Note: in current callers, `source` only arrives as
		// `'inventory-seed'` / `'inventory-discovered'` / `undefined`
		// (`derivePageSource` never emits `'crawled'`, and outside inventory
		// mode `source` is `undefined` so this CASE never runs). The
		// `? = 'crawled'` branch is therefore reachable only via a future
		// call site that wants to explicitly assert a crawled lineage —
		// today the actual crawled-wins downgrade fires in `#getIdByUrl`'s
		// SELECT path when an anchor lineage `'crawled'` lands on an
		// existing `'inventory-*'` row. The branch is kept so the CASE
		// completely describes the priority lattice in one place.
		const sourceUpdate =
			source === undefined
				? {}
				: {
						source: qb.raw(
							`CASE
								WHEN source = 'crawled' OR ? = 'crawled' THEN 'crawled'
								WHEN source = 'inventory-seed' OR ? = 'inventory-seed' THEN 'inventory-seed'
								WHEN source = 'inventory-discovered' OR ? = 'inventory-discovered' THEN 'inventory-discovered'
								ELSE source
							END`,
							[source, source, source],
						),
					};
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
				// Flat meta columns derived from beholder 3.0.0 nested Meta.
				// URL-shaped columns (canonical / og_url / og_image / amphtml / manifest /
				// icon_href / appleTouchIcon_href / twitter_image) are already absolutised
				// by `deriveFlatFromMeta` against the page URL — `find-mismatches` compares
				// `canonical != url` directly, so storing the raw `getAttribute('href')`
				// would generate false positives for sites using relative canonicals.
				...flat,
				// Denormalised aggregates: written once at scrape time so list reads
				// (Sheets, page-detail summary) can answer "how many JSON-LD entries?"
				// and "which Wappalyzer providers?" by selecting a single pages column
				// rather than running a GROUP BY join on every read.
				tag_count: denorm.tag_count,
				jsonld_count: denorm.jsonld_count,
				tags_providers_csv: denorm.tags_providers_csv,
				// JSON catch-all for nested Meta sub-objects not flattened above.
				meta_extras: JSON.stringify(extras),
				// Timestamps: `firstCrawledAt` is set only on first INSERT — `COALESCE`
				// preserves the existing value so a re-scrape (`--append`, `--retry-failed`)
				// does not erase the discovery time. `lastCrawledAt` is updated every
				// successful scrape.
				firstCrawledAt: qb.raw('COALESCE(firstCrawledAt, ?)', [now]),
				lastCrawledAt: now,
				isSkipped: page.isSkipped,
				...sourceUpdate,
			});
		return pageId;
	}

	/**
	 * Replaces the page's Wappalyzer tag rows with the freshly captured set.
	 * Called inside `updatePage`'s transaction unconditionally — tag
	 * detection draws on `<script src>` / `<iframe src>` / window globals /
	 * response headers, not the HTML body, so external pages that skip
	 * rendering still contribute tags.
	 *
	 * Same empty-guard as `#insertJsonLd`: an empty array does not wipe
	 * prior rows on a degraded re-scrape.
	 * @param pageId
	 * @param meta
	 * @param trx
	 */
	async #insertTags(
		pageId: number,
		meta: PageData['meta'],
		trx: Knex.Transaction,
	): Promise<void> {
		const partial = extractTagsForArchive(meta.tags);
		if (partial.length === 0) return;
		const rows = partial.map((p) => ({
			pageId,
			provider: p.provider,
			category: p.category,
			externalId: p.externalId,
			version: p.version,
			confidence: p.confidence,
			categories: JSON.stringify(p.categories),
			sources: JSON.stringify(p.sources),
		}));
		await trx('page_tags').where('pageId', pageId).delete();
		await eachSplitted(rows, 100, async (chunk) => {
			await trx('page_tags').insert(chunk);
		});
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
	 * @param chainLineageSource - Lineage label propagated to each intermediate
	 *   hop's row (passed through to {@link #getIdByUrl}). Derived by the caller
	 *   from the **originating** page's source (`page.url`), not from the
	 *   destination — intermediates are reached transitively from the
	 *   originating render, so they inherit its lineage. Pass `'inventory-discovered'`
	 *   for chains rooted at inventory-seed/discovered pages so new intermediates
	 *   stay in the inventory chain; pass `'crawled'` for crawled chains so the
	 *   crawled-wins downgrade inside `#getIdByUrl` fires on existing
	 *   `'inventory-*'` intermediates a crawled chain reaches. Pass `undefined`
	 *   to fall back to the DB DEFAULT (`'crawled'`) on INSERT without
	 *   triggering the downgrade on existing rows.
	 */
	async #linkRedirectSources(
		trx: Knex.Transaction,
		sources: readonly string[],
		destId: number,
		destUrlNormalized: string,
		isExternal: boolean,
		chainLineageSource?: PageSource,
	): Promise<void> {
		for (const redirect of sources) {
			if (redirect === destUrlNormalized) {
				dbLog('Skip self-redirect: %s', redirect);
				continue;
			}
			dbLog('Set redirected url: %s -> id:%d', redirect, destId);
			// Pass `chainLineageSource` through so a brand-new
			// intermediate hop INSERTed here inherits the originating
			// page's lineage label (inventory-discovered when the
			// originating chain is in the inventory chain, undefined
			// otherwise). The crawled-wins downgrade inside
			// `#getIdByUrl` still fires when this argument is `'crawled'`,
			// matching the anchor-lineage propagation contract — an
			// existing inventory-* intermediate that is later traversed
			// by a `'crawled'` chain gets downgraded.
			const redirectId = await this.#getIdByUrl(
				redirect,
				undefined,
				trx,
				chainLineageSource,
			);
			await trx<DB_Page>('pages')
				.where('id', redirectId)
				.update({
					scraped: 1,
					redirectDestId: destId,
					isExternal: isExternal ? 1 : 0,
				});
			// Conditional `301 Moved Permanently` stamp — applied ONLY
			// when the row carries no definitive status yet (NULL or
			// the `-1` hard-failure sentinel). HEAD pre-flight does not
			// retain each hop's individual status code (`redirectPaths`
			// is a URL[] without statuses), so the only honest answer
			// for an unknown-status hop is "some 3xx" — 301 is the
			// canonical representative.
			//
			// We deliberately do NOT overwrite an existing definitive
			// status (200 / 302 / 307 / etc.): a row that already
			// captured a concrete status from a prior direct scrape
			// would lose accuracy. The stamp only flips two cases:
			// - NULL: a placeholder row created by `#getIdByUrl`
			//   because the URL was reached only as a redirect
			//   target / source, never directly scraped. Without the
			//   stamp the row is invisible on the Errors view's status
			//   distribution.
			// - -1: a row that recorded a hard scrape failure (e.g. a
			//   puppeteer goto returned null on a HTTPS→HTTP downgrade
			//   redirect) BEFORE the chain was understood. That `-1`
			//   then conflated "real failure" with "actually a redirect
			//   source we now know about", polluting the `-1` bucket
			//   AND inflating the `--retry-failed` target (via the
			//   `whereNull('redirectDestId')` filter — the redirectDestId
			//   update above already excludes the row from retry; this
			//   stamp restores the visible identity).
			await trx<DB_Page>('pages')
				.where('id', redirectId)
				.where((qb) => qb.whereNull('status').orWhere('status', -1))
				.update({ status: 301, statusText: 'Moved Permanently' });
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
	 * Encodes, dedups, and persists a page's HTML snapshot.
	 *
	 * Computes SHA-256 over the raw UTF-8 bytes, compresses them with zstd,
	 * inserts into `page_html_blobs` only if the hash is new (so identical
	 * bodies — 404 templates, error pages, redirect destinations — share a
	 * single row), and then upserts `page_html_ref(page_id → hash)` so the
	 * latest scrape always points at the right body.
	 *
	 * Runs entirely inside the caller's transaction; a failure here rolls
	 * back the rest of `updatePage`, which is the desired semantics (an
	 * archive that lost its HTML for a page would otherwise serve stale
	 * meta against a missing body).
	 * @param pageId - The database id of the page.
	 * @param html - The raw HTML string (UTF-8).
	 * @param trx - The active transaction.
	 */
	async #writePageHtmlBlob(
		pageId: number,
		html: string,
		trx: Knex.Transaction,
	): Promise<void> {
		const rawBytes = Buffer.from(html, 'utf8');
		const hash = createHash('sha256').update(rawBytes).digest();
		const compressed = zstdCompressSync(rawBytes);
		await trx('page_html_blobs')
			.insert({
				hash,
				body: compressed,
				codec: 'zstd',
				size_raw: rawBytes.byteLength,
				size_stored: compressed.byteLength,
			})
			.onConflict('hash')
			.ignore();
		// Upsert so a re-scrape's body cleanly supersedes the prior pointer.
		// The old blob row is intentionally left in place — a future #23 GC
		// pass will sweep unreachable hashes.
		await trx('page_html_ref')
			.insert({ page_id: pageId, hash })
			.onConflict('page_id')
			.merge(['hash']);
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
