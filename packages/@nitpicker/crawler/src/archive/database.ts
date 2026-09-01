import type { TemplateClusterReason } from './db-ops/analysis/types.js';
import type {
	JsonLdRow,
	MainContentAudioRow,
	MainContentButtonRow,
	MainContentCanvasRow,
	MainContentCustomElementRow,
	MainContentHeadingRow,
	MainContentIframeRow,
	MainContentImageRow,
	MainContentTableRow,
	MainContentVideoRow,
	PageTechnologyRow,
	TechnologySignalRow,
} from './meta/types.js';
import type {
	Config,
	DatabaseOption,
	DB_Redirect,
	DB_Resource,
	DatabaseEvent,
	InsertDedupeCapEventParams,
	InsertNetworkOutageParams,
	InventoryRunMeta,
	PageFilter,
	PageSource,
	ResetPagesByUrlsResult,
} from './types.js';
import type { OutageWindow } from '../is-within-outage-window.js';
import type { PageData, Resource } from '../utils/types/types.js';
import type { ConsoleLogEntry } from '@d-zero/beholder';
import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';
import type { Knex } from 'knex';

import { existsSync } from 'node:fs';
import path from 'node:path';

import { retryCall } from '@d-zero/shared/retry';
import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';
import knex from 'knex';

import { emitErrorAndRetry } from '../utils/error/emit-error-with-retry.js';
import { emitError } from '../utils/error/emit-error.js';

import { createWriteRefCaches } from './db-ops/_shared/create-write-ref-caches.js';
import { retrySetting } from './db-ops/_shared/retry-setting.js';
import { replaceAnalysisViolations as replaceAnalysisViolationsOp } from './db-ops/analysis/replace-analysis-violations.js';
import { replacePageTemplates as replacePageTemplatesOp } from './db-ops/analysis/replace-page-templates.js';
import { getAnchorsOnPage as getAnchorsOnPageOp } from './db-ops/anchors/get-anchors-on-page.js';
import { getBaseUrl as getBaseUrlOp } from './db-ops/config/get-base-url.js';
import { getConfig as getConfigOp } from './db-ops/config/get-config.js';
import { getName as getNameOp } from './db-ops/config/get-name.js';
import { setConfig as setConfigOp } from './db-ops/config/set-config.js';
import { updateConfig as updateConfigOp } from './db-ops/config/update-config.js';
import { replaceConsoleLogs as replaceConsoleLogsOp } from './db-ops/console-logs/replace-console-logs.js';
import { accumulateDedupeCapRejectedCount as accumulateDedupeCapRejectedCountOp } from './db-ops/dedupe-cap/accumulate-dedupe-cap-rejected-count.js';
import { finalizeDedupeCapEvent as finalizeDedupeCapEventOp } from './db-ops/dedupe-cap/finalize-dedupe-cap-event.js';
import { insertDedupeCapEvent as insertDedupeCapEventOp } from './db-ops/dedupe-cap/insert-dedupe-cap-event.js';
import { listDedupeCapShapeKeys as listDedupeCapShapeKeysOp } from './db-ops/dedupe-cap/list-dedupe-cap-shape-keys.js';
import { insertCrawlError as insertCrawlErrorOp } from './db-ops/errors/insert-crawl-error.js';
import { insertPageError as insertPageErrorOp } from './db-ops/errors/insert-page-error.js';
import { listDnsBurnedHostCandidates as listDnsBurnedHostCandidatesOp } from './db-ops/errors/list-dns-burned-host-candidates.js';
import { getHtmlOfPageById as getHtmlOfPageByIdOp } from './db-ops/html/get-html-of-page-by-id.js';
import { recordInventoryRun as recordInventoryRunOp } from './db-ops/inventory/record-inventory-run.js';
import { checkpoint as checkpointOp } from './db-ops/lifecycle/checkpoint.js';
import { destroy as destroyOp } from './db-ops/lifecycle/destroy.js';
import { init as initOp } from './db-ops/lifecycle/init.js';
import { getAudiosOfPage as getAudiosOfPageOp } from './db-ops/meta/get-audios-of-page.js';
import { getButtonsOfPage as getButtonsOfPageOp } from './db-ops/meta/get-buttons-of-page.js';
import { getCanvasesOfPage as getCanvasesOfPageOp } from './db-ops/meta/get-canvases-of-page.js';
import { getCustomElementsOfPage as getCustomElementsOfPageOp } from './db-ops/meta/get-custom-elements-of-page.js';
import { getHeadingsOfPage as getHeadingsOfPageOp } from './db-ops/meta/get-headings-of-page.js';
import { getIframesOfPage as getIframesOfPageOp } from './db-ops/meta/get-iframes-of-page.js';
import { getJsonLdOfPage as getJsonLdOfPageOp } from './db-ops/meta/get-jsonld-of-page.js';
import { getMainContentImagesOfPage as getMainContentImagesOfPageOp } from './db-ops/meta/get-main-content-images-of-page.js';
import { getMainContentTablesOfPage as getMainContentTablesOfPageOp } from './db-ops/meta/get-main-content-tables-of-page.js';
import { getPageTechnologiesOfPage as getPageTechnologiesOfPageOp } from './db-ops/meta/get-page-technologies-of-page.js';
import { getTechnologySignalsOfPage as getTechnologySignalsOfPageOp } from './db-ops/meta/get-technology-signals-of-page.js';
import { getVideosOfPage as getVideosOfPageOp } from './db-ops/meta/get-videos-of-page.js';
import { closeNetworkOutage as closeNetworkOutageOp } from './db-ops/outages/close-network-outage.js';
import { insertNetworkOutage as insertNetworkOutageOp } from './db-ops/outages/insert-network-outage.js';
import { listNetworkOutages as listNetworkOutagesOp } from './db-ops/outages/list-network-outages.js';
import { setUrlOrder as setUrlOrderOp } from './db-ops/pages/order/set-url-order.js';
import { getCrawlingState as getCrawlingStateOp } from './db-ops/pages/read/get-crawling-state.js';
import { getExistingPageUrls as getExistingPageUrlsOp } from './db-ops/pages/read/get-existing-page-urls.js';
import { getPageCount as getPageCountOp } from './db-ops/pages/read/get-page-count.js';
import { getPageSourceByUrl as getPageSourceByUrlOp } from './db-ops/pages/read/get-page-source-by-url.js';
import { getPagesWithRels as getPagesWithRelsOp } from './db-ops/pages/read/get-pages-with-rels.js';
import { getPages as getPagesOp } from './db-ops/pages/read/get-pages.js';
import { getScrapedHtmlPageCount as getScrapedHtmlPageCountOp } from './db-ops/pages/read/get-scraped-html-page-count.js';
import { repromoteExternalPages as repromoteExternalPagesOp } from './db-ops/pages/reset/repromote-external-pages.js';
import { resetFailedPages as resetFailedPagesOp } from './db-ops/pages/reset/reset-failed-pages.js';
import { resetPagesByUrls as resetPagesByUrlsOp } from './db-ops/pages/reset/reset-pages-by-urls.js';
import { insertInventorySeeds as insertInventorySeedsOp } from './db-ops/pages/write/insert-inventory-seeds.js';
import { insertInventorySkippedPages as insertInventorySkippedPagesOp } from './db-ops/pages/write/insert-inventory-skipped-pages.js';
import { recordRedirect as recordRedirectOp } from './db-ops/pages/write/record-redirect.js';
import { setSkippedPage as setSkippedPageOp } from './db-ops/pages/write/set-skipped-page.js';
import { updatePage as updatePageOp } from './db-ops/pages/write/update-page.js';
import { getRedirectsForPages as getRedirectsForPagesOp } from './db-ops/referrers/get-redirects-for-pages.js';
import { getReferrersOfPage as getReferrersOfPageOp } from './db-ops/referrers/get-referrers-of-page.js';
import { getReferrersOfResource as getReferrersOfResourceOp } from './db-ops/referrers/get-referrers-of-resource.js';
import { getExistingResourceUrls as getExistingResourceUrlsOp } from './db-ops/resources/get-existing-resource-urls.js';
import { getResourceByUrl as getResourceByUrlOp } from './db-ops/resources/get-resource-by-url.js';
import { getResourceUrlList as getResourceUrlListOp } from './db-ops/resources/get-resource-url-list.js';
import { getResources as getResourcesOp } from './db-ops/resources/get-resources.js';
import { insertInventoryResources as insertInventoryResourcesOp } from './db-ops/resources/insert-inventory-resources.js';
import { insertResourceReferrers as insertResourceReferrersOp } from './db-ops/resources/insert-resource-referrers.js';
import { insertResource as insertResourceOp } from './db-ops/resources/insert-resource.js';
import { mkdir } from './filesystem/mkdir.js';
import { LibsqlDialect } from './libsql-dialect.js';

/**
 * Low-level database abstraction layer for the archive's SQLite database.
 *
 * Every method is a thin dispatcher: the SQL itself lives in a dedicated
 * single-export op module under `./db-ops/` (one file per operation), and
 * the class contributes only the connection (`this.#instance`) plus the
 * error/retry wrapper. Public methods that perform database queries use the
 * `emitErrorAndRetry` HOF for automatic retry on transient failures combined
 * with error-event propagation, or `emitError` when retry is not appropriate.
 * The set of tables this layer manages is defined by `init-schema.ts` (the
 * source of truth — query that file for the canonical list).
 *
 * **Label sync caveat**: each `emitError` / `emitErrorAndRetry` call passes
 * the method name as a string literal (e.g. `'Database.getAnchorsOnPage'`).
 * TypeScript cannot check that the string matches the enclosing method's
 * real name — the two-way sync is manual. Renaming a method here **must**
 * update the literal string too, otherwise debug logs and `RetryTimeoutError`
 * messages will silently report the old name.
 *
 * Use the static {@link Database.connect} factory method to create instances.
 * The constructor is private.
 */
export class Database extends EventEmitter<DatabaseEvent> {
	/** The Knex query builder instance connected to the SQLite database. */
	#instance: Knex;
	/** Connection-scoped write-side id caches for entity/ref upserts. */
	#writeRefCaches = createWriteRefCaches();
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
	 * Adds onto the `rejected_count` of a shape's `dedupe_cap_events` row,
	 * looked up by `shape_key` rather than `id`. Delegates to
	 * {@link accumulateDedupeCapRejectedCountOp}.
	 * @param shapeKey - The capped shape whose rejection count to accumulate.
	 * @param rejectedCount - Additional anchors rejected for this shape in the current session.
	 */
	async accumulateDedupeCapRejectedCount(
		shapeKey: string,
		rejectedCount: number,
	): Promise<void> {
		return emitErrorAndRetry(
			this,
			'Database.accumulateDedupeCapRejectedCount',
			async () =>
				await accumulateDedupeCapRejectedCountOp(this.#instance, shapeKey, rejectedCount),
			retrySetting,
		);
	}
	/**
	 * Forces a WAL checkpoint, writing all pending WAL data back to the main
	 * database file. Delegates to {@link checkpointOp}.
	 */
	async checkpoint() {
		await checkpointOp(this.#instance);
	}
	/**
	 * Closes an outage row by stamping `ended_at` — a no-op if the row is
	 * already closed. Delegates to {@link closeNetworkOutageOp}.
	 * @param id - The `network_outages.id` to close.
	 * @param endedAt - Epoch ms the outage is considered to have ended.
	 */
	async closeNetworkOutage(id: number, endedAt: number): Promise<void> {
		return emitErrorAndRetry(
			this,
			'Database.closeNetworkOutage',
			async () => await closeNetworkOutageOp(this.#instance, id, endedAt),
			retrySetting,
		);
	}
	/**
	 * Destroys the database connection, releasing all pooled resources.
	 * Delegates to {@link destroyOp}.
	 */
	async destroy() {
		await destroyOp(this.#instance);
	}
	/**
	 * Finalizes a `dedupe_cap_events` row by stamping `rejected_count` — a
	 * no-op if the row is already finalized. Delegates to
	 * {@link finalizeDedupeCapEventOp}.
	 * @param id - The `dedupe_cap_events.id` to finalize.
	 * @param rejectedCount - Number of anchors rejected for this shape after it capped.
	 */
	async finalizeDedupeCapEvent(id: number, rejectedCount: number): Promise<void> {
		return emitErrorAndRetry(
			this,
			'Database.finalizeDedupeCapEvent',
			async () => await finalizeDedupeCapEventOp(this.#instance, id, rejectedCount),
			retrySetting,
		);
	}

	/**
	 * Retrieves all anchors (outgoing links) on a specific page.
	 * Delegates to {@link getAnchorsOnPageOp}.
	 * @param pageId - The database ID of the page whose anchors to retrieve.
	 * @returns An array of anchor records with resolved URL, title, status, and content type.
	 */
	async getAnchorsOnPage(pageId: number) {
		return emitErrorAndRetry(
			this,
			'Database.getAnchorsOnPage',
			async () => await getAnchorsOnPageOp(this.#instance, pageId),
			retrySetting,
		);
	}
	/**
	 * Retrieves all `page_main_content_audios` rows for the given page id.
	 * Delegates to {@link getAudiosOfPageOp}.
	 * @param pageId
	 */
	async getAudiosOfPage(pageId: number): Promise<MainContentAudioRow[]> {
		return emitErrorAndRetry(
			this,
			'Database.getAudiosOfPage',
			async () => await getAudiosOfPageOp(this.#instance, pageId),
			retrySetting,
		);
	}
	/**
	 * Retrieves the base URL of the crawl session from the `info` table.
	 * Delegates to {@link getBaseUrlOp}.
	 * @returns The base URL string.
	 * @throws {Error} If no base URL is found in the database.
	 */
	async getBaseUrl() {
		return emitErrorAndRetry(
			this,
			'Database.getBaseUrl',
			async () => await getBaseUrlOp(this.#instance),
			retrySetting,
		);
	}
	/**
	 * Retrieves all `page_main_content_buttons` rows for the given page id.
	 * Delegates to {@link getButtonsOfPageOp}.
	 * @param pageId
	 */
	async getButtonsOfPage(pageId: number): Promise<MainContentButtonRow[]> {
		return emitErrorAndRetry(
			this,
			'Database.getButtonsOfPage',
			async () => await getButtonsOfPageOp(this.#instance, pageId),
			retrySetting,
		);
	}
	/**
	 * Retrieves all `page_main_content_canvases` rows for the given page id.
	 * Delegates to {@link getCanvasesOfPageOp}.
	 * @param pageId
	 */
	async getCanvasesOfPage(pageId: number): Promise<MainContentCanvasRow[]> {
		return emitErrorAndRetry(
			this,
			'Database.getCanvasesOfPage',
			async () => await getCanvasesOfPageOp(this.#instance, pageId),
			retrySetting,
		);
	}
	/**
	 * Retrieves the full crawl configuration from the `info` table.
	 * Delegates to {@link getConfigOp}.
	 * @returns The parsed {@link Config} object.
	 * @throws {Error} If no configuration is found in the database.
	 */
	async getConfig() {
		return emitErrorAndRetry(
			this,
			'Database.getConfig',
			async () => await getConfigOp(this.#instance),
			retrySetting,
		);
	}
	/**
	 * Retrieves the current crawling state by listing scraped and pending URLs.
	 * Delegates to {@link getCrawlingStateOp} — see the op for the strict
	 * pending-set rationale.
	 * @returns An object with `scraped` (completed URLs) and `pending` (the
	 *   strict set of in-scope, anchor-referenced, unfinished URLs).
	 */
	async getCrawlingState() {
		return emitErrorAndRetry(
			this,
			'Database.getCrawlingState',
			async () => await getCrawlingStateOp(this.#instance),
			retrySetting,
		);
	}
	/**
	 * Retrieves all `page_main_content_custom_elements` rows for the given
	 * page id. Delegates to {@link getCustomElementsOfPageOp}.
	 * @param pageId
	 */
	async getCustomElementsOfPage(pageId: number): Promise<MainContentCustomElementRow[]> {
		return emitErrorAndRetry(
			this,
			'Database.getCustomElementsOfPage',
			async () => await getCustomElementsOfPageOp(this.#instance, pageId),
			retrySetting,
		);
	}

	/**
	 * Return the subset of `urls` that already exist in the `pages` table.
	 * Delegates to {@link getExistingPageUrlsOp}.
	 * @param urls - URL strings to probe (already in `withoutHashAndAuth` form).
	 * @returns URLs found in `pages`. Order is not preserved.
	 */
	async getExistingPageUrls(urls: readonly string[]): Promise<string[]> {
		return emitError(
			this,
			'Database.getExistingPageUrls',
			async () => await getExistingPageUrlsOp(this.#instance, urls),
		);
	}
	/**
	 * Return the subset of `urls` that already exist in the `resources` table.
	 * Delegates to {@link getExistingResourceUrlsOp}.
	 * @param urls - URL strings to probe.
	 * @returns URLs found in `resources`.
	 */
	async getExistingResourceUrls(urls: readonly string[]): Promise<string[]> {
		return emitError(
			this,
			'Database.getExistingResourceUrls',
			async () => await getExistingResourceUrlsOp(this.#instance, urls),
		);
	}
	/**
	 * Retrieves all `page_main_content_headings` rows for the given page id.
	 * Delegates to {@link getHeadingsOfPageOp}.
	 * @param pageId
	 */
	async getHeadingsOfPage(pageId: number): Promise<MainContentHeadingRow[]> {
		return emitErrorAndRetry(
			this,
			'Database.getHeadingsOfPage',
			async () => await getHeadingsOfPageOp(this.#instance, pageId),
			retrySetting,
		);
	}
	/**
	 * Reads the HTML snapshot stored as a zstd-compressed BLOB for the given page.
	 * Delegates to {@link getHtmlOfPageByIdOp}.
	 * @param pageId - The database ID of the page.
	 * @returns The decompressed HTML string, or `null` if no snapshot is stored.
	 */
	async getHtmlOfPageById(pageId: number): Promise<string | null> {
		return emitErrorAndRetry(
			this,
			'Database.getHtmlOfPageById',
			async () => await getHtmlOfPageByIdOp(this.#instance, pageId),
			retrySetting,
		);
	}
	/**
	 * Retrieves all `page_main_content_iframes` rows for the given page id.
	 * Delegates to {@link getIframesOfPageOp}.
	 * @param pageId
	 */
	async getIframesOfPage(pageId: number): Promise<MainContentIframeRow[]> {
		return emitErrorAndRetry(
			this,
			'Database.getIframesOfPage',
			async () => await getIframesOfPageOp(this.#instance, pageId),
			retrySetting,
		);
	}
	/**
	 * Retrieves all `page_jsonld` rows for the given page id, parsed back into
	 * {@link JsonLdRow} shape. Delegates to {@link getJsonLdOfPageOp}.
	 * @param pageId
	 */
	async getJsonLdOfPage(pageId: number): Promise<JsonLdRow[]> {
		return emitErrorAndRetry(
			this,
			'Database.getJsonLdOfPage',
			async () => await getJsonLdOfPageOp(this.#instance, pageId),
			retrySetting,
		);
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
	 * Retrieves all `page_main_content_images` rows for the given page id.
	 * Delegates to {@link getMainContentImagesOfPageOp}.
	 * @param pageId
	 */
	async getMainContentImagesOfPage(pageId: number): Promise<MainContentImageRow[]> {
		return emitErrorAndRetry(
			this,
			'Database.getMainContentImagesOfPage',
			async () => await getMainContentImagesOfPageOp(this.#instance, pageId),
			retrySetting,
		);
	}

	/**
	 * Retrieves all `page_main_content_tables` rows for the given page id.
	 * Delegates to {@link getMainContentTablesOfPageOp}.
	 * @param pageId
	 */
	async getMainContentTablesOfPage(pageId: number): Promise<MainContentTableRow[]> {
		return emitErrorAndRetry(
			this,
			'Database.getMainContentTablesOfPage',
			async () => await getMainContentTablesOfPageOp(this.#instance, pageId),
			retrySetting,
		);
	}

	/**
	 * Retrieves the crawl session name from the `info` table.
	 * Delegates to {@link getNameOp}.
	 * @returns The name string.
	 * @throws {Error} If no name is found in the database.
	 */
	async getName() {
		return emitErrorAndRetry(
			this,
			'Database.getName',
			async () => await getNameOp(this.#instance),
			retrySetting,
		);
	}
	/**
	 * Counts the total number of pages in the database.
	 * Delegates to {@link getPageCountOp}.
	 * @returns The total page count.
	 * @throws {Error} If the count query fails.
	 */
	async getPageCount() {
		return emitErrorAndRetry(
			this,
			'Database.getPageCount',
			async () => await getPageCountOp(this.#instance),
			retrySetting,
		);
	}
	/**
	 * Retrieves pages from the database with optional filtering, pagination via
	 * offset and limit. Delegates to {@link getPagesOp}.
	 * @param filter - An optional {@link PageFilter} to narrow results by content type and origin.
	 * @param offset - The number of rows to skip. Defaults to `0`.
	 * @param limit - The maximum number of rows to return. Defaults to `100000`.
	 * @returns An array of raw `DB_Page` rows.
	 */
	async getPages(filter?: PageFilter, offset = 0, limit = 100_000) {
		return emitErrorAndRetry(
			this,
			'Database.getPages',
			async () => await getPagesOp(this.#instance, filter, offset, limit),
			retrySetting,
		);
	}
	/**
	 * Look up the `source` column of a single page by its URL key.
	 * Delegates to {@link getPageSourceByUrlOp}.
	 * @param url - URL key in `url.withoutHashAndAuth` form.
	 * @returns The recorded `source`, or `undefined` when no row exists.
	 */
	async getPageSourceByUrl(url: string): Promise<PageSource | undefined> {
		return emitError(
			this,
			'Database.getPageSourceByUrl',
			async () => await getPageSourceByUrlOp(this.#instance, url),
		);
	}
	/**
	 * Retrieves pages along with their related redirect, anchor, and referrer data.
	 * Results are ordered by the natural URL sort order. Only non-redirected pages
	 * are returned. Delegates to {@link getPagesWithRelsOp}.
	 * @param offset - The number of rows to skip.
	 * @param limit - The maximum number of pages to return.
	 * @returns An object containing `pages`, `redirects`, `anchors`, and `referrers` arrays.
	 */
	async getPagesWithRels(offset: number, limit: number) {
		return emitErrorAndRetry(
			this,
			'Database.getPagesWithRels',
			async () => await getPagesWithRelsOp(this.#instance, offset, limit),
			retrySetting,
		);
	}
	/**
	 * Retrieves all `page_technologies` rows for the given page id.
	 * Delegates to {@link getPageTechnologiesOfPageOp}.
	 * @param pageId
	 */
	async getPageTechnologiesOfPage(pageId: number): Promise<PageTechnologyRow[]> {
		return emitErrorAndRetry(
			this,
			'Database.getPageTechnologiesOfPage',
			async () => await getPageTechnologiesOfPageOp(this.#instance, pageId),
			retrySetting,
		);
	}
	/**
	 * Retrieves redirect sources for the given page IDs in bulk.
	 * Delegates to {@link getRedirectsForPagesOp}.
	 * @param pageIds - The database IDs of the destination pages.
	 * @returns An array of {@link DB_Redirect} records mapping destination pages to their redirect sources.
	 */
	async getRedirectsForPages(pageIds: number[]): Promise<DB_Redirect[]> {
		return emitErrorAndRetry(
			this,
			'Database.getRedirectsForPages',
			async () => await getRedirectsForPagesOp(this.#instance, pageIds),
			retrySetting,
		);
	}
	/**
	 * Retrieves pages that link to a specific page (incoming links / referrers),
	 * resolved through redirects. Delegates to {@link getReferrersOfPageOp}.
	 * @param pageId - The database ID of the target page.
	 * @returns An array of referrer records with URL, hash, and text content.
	 */
	async getReferrersOfPage(pageId: number) {
		return emitErrorAndRetry(
			this,
			'Database.getReferrersOfPage',
			async () => await getReferrersOfPageOp(this.#instance, pageId),
			retrySetting,
		);
	}
	/**
	 * Retrieves the page URLs that reference a specific resource.
	 * Delegates to {@link getReferrersOfResourceOp}.
	 * @param id - The database ID of the resource.
	 * @returns An array of page URL strings that reference the resource.
	 */
	async getReferrersOfResource(id: number): Promise<string[]> {
		return emitErrorAndRetry(
			this,
			'Database.getReferrersOfResource',
			async () => await getReferrersOfResourceOp(this.#instance, id),
			retrySetting,
		);
	}
	/**
	 * Retrieves a single sub-resource from the `resources` table by its URL.
	 * Delegates to {@link getResourceByUrlOp}.
	 *
	 * Deliberately NOT wrapped with `emitError`/`emitErrorAndRetry`: the only caller (the
	 * crawler's resource-reuse hook) has a full fallback (the HEAD pre-flight),
	 * so a read failure here must not surface as a database `error` event —
	 * the orchestrator aborts the whole crawl on that event, which is the
	 * correct reaction to write failures but not to a recoverable read.
	 * @param urls - URL candidates to match against the `url` column.
	 * @returns The raw {@link DB_Resource} row, or `null` if none match.
	 */
	async getResourceByUrl(urls: readonly string[]): Promise<DB_Resource | null> {
		return retryCall(async () => await getResourceByUrlOp(this.#instance, urls), {
			...retrySetting,
			label: 'Database.getResourceByUrl',
		});
	}
	/**
	 * Retrieves all sub-resources from the `resources` table.
	 * Delegates to {@link getResourcesOp}.
	 * @returns An array of raw {@link DB_Resource} rows.
	 */
	async getResources() {
		return emitErrorAndRetry(
			this,
			'Database.getResources',
			async () => await getResourcesOp(this.#instance),
			retrySetting,
		);
	}
	/**
	 * Retrieves a flat list of all resource URLs from the `resources` table.
	 * Delegates to {@link getResourceUrlListOp}.
	 *
	 * `onProgress` is clamped to a high-water mark across retries: a
	 * transient failure partway through the keyset scan restarts
	 * {@link getResourceUrlListOp} from `id = 0` (its own `lastId` is a local
	 * closure variable, reset on every `fn` invocation `retryCall` retries),
	 * which would otherwise visibly rewind the reported progress backwards
	 * before catching back up.
	 * @param onProgress - Forwarded to {@link getResourceUrlListOp} — see
	 *   that function's docs.
	 * @returns An array of resource URL strings.
	 */
	async getResourceUrlList(onProgress?: (scannedUpToId: number, maxId: number) => void) {
		let highWaterMark = 0;
		const monotonicProgress = onProgress
			? (scannedUpToId: number, maxId: number) => {
					highWaterMark = Math.max(highWaterMark, scannedUpToId);
					onProgress(highWaterMark, maxId);
				}
			: undefined;
		return emitErrorAndRetry(
			this,
			'Database.getResourceUrlList',
			async () => await getResourceUrlListOp(this.#instance, monotonicProgress),
			retrySetting,
		);
	}
	/**
	 * Counts pages that were scraped as crawl targets (full HTML render).
	 * Delegates to {@link getScrapedHtmlPageCountOp}.
	 * @returns The number of `text/html` rows with `isTarget = 1` and `scraped = 1`.
	 */
	async getScrapedHtmlPageCount() {
		return emitErrorAndRetry(
			this,
			'Database.getScrapedHtmlPageCount',
			async () => await getScrapedHtmlPageCountOp(this.#instance),
			retrySetting,
		);
	}
	/**
	 * Retrieves all `technology_signals` rows for the given page id.
	 * Delegates to {@link getTechnologySignalsOfPageOp}.
	 * @param pageId
	 */
	async getTechnologySignalsOfPage(pageId: number): Promise<TechnologySignalRow[]> {
		return emitErrorAndRetry(
			this,
			'Database.getTechnologySignalsOfPage',
			async () => await getTechnologySignalsOfPageOp(this.#instance, pageId),
			retrySetting,
		);
	}

	/**
	 * Retrieves all `page_main_content_videos` rows for the given page id.
	 * Delegates to {@link getVideosOfPageOp}.
	 * @param pageId
	 */
	async getVideosOfPage(pageId: number): Promise<MainContentVideoRow[]> {
		return emitErrorAndRetry(
			this,
			'Database.getVideosOfPage',
			async () => await getVideosOfPageOp(this.#instance, pageId),
			retrySetting,
		);
	}

	/**
	 * Records a crawler-level (`error` channel) failure into `crawl_errors`.
	 * Delegates to {@link insertCrawlErrorOp}.
	 * @param url - The URL the error is about, or `null` for a process-level error.
	 * @param message - The error message (one line is enough for classification).
	 * @param isExternal - Whether the URL is external to the crawl scope.
	 */
	async insertCrawlError(url: string | null, message: string, isExternal = false) {
		return emitErrorAndRetry(
			this,
			'Database.insertCrawlError',
			async () => await insertCrawlErrorOp(this.#instance, url, message, isExternal),
			retrySetting,
		);
	}
	/**
	 * Appends one row (`rejected_count = NULL`) to the `dedupe_cap_events`
	 * journal. Delegates to {@link insertDedupeCapEventOp}.
	 * @param params - The newly-capped shape's fields to record.
	 * @returns The autoincremented `id` of the newly-inserted row.
	 */
	async insertDedupeCapEvent(params: InsertDedupeCapEventParams): Promise<number> {
		return emitErrorAndRetry(
			this,
			'Database.insertDedupeCapEvent',
			async () => await insertDedupeCapEventOp(this.#instance, params),
			retrySetting,
		);
	}
	/**
	 * Pre-insert inventory non-HTML URLs into `resources` as placeholder rows.
	 * Delegates to {@link insertInventoryResourcesOp}.
	 * @param urls - URL strings (already in `withoutHashAndAuth` form).
	 */
	async insertInventoryResources(urls: readonly string[]): Promise<void> {
		return emitErrorAndRetry(
			this,
			'Database.insertInventoryResources',
			async () =>
				await insertInventoryResourcesOp(this.#instance, this.#writeRefCaches, urls),
			retrySetting,
		);
	}

	/**
	 * Pre-insert inventory HTML seeds into `pages` as `scraped = 0`,
	 * `source = 'inventory-seed'` placeholders. Delegates to
	 * {@link insertInventorySeedsOp} — see the op for the Ctrl+C tolerance
	 * rationale.
	 * @param urls - URL strings already in `withoutHashAndAuth` form.
	 */
	async insertInventorySeeds(urls: readonly string[]): Promise<void> {
		return emitErrorAndRetry(
			this,
			'Database.insertInventorySeeds',
			async () =>
				await insertInventorySeedsOp(this.#instance, this.#writeRefCaches, urls),
			retrySetting,
		);
	}

	/**
	 * Records exclude-matched inventory URLs as terminal skipped pages
	 * (`scraped=1`, `is_skipped=1`, `skip_reason='excluded'`,
	 * `source='inventory-seed'`). Delegates to
	 * {@link insertInventorySkippedPagesOp} — see that op's JSDoc for the
	 * normal-crawl parity rationale.
	 * @param urls - URL strings already in `withoutHashAndAuth` form.
	 */
	async insertInventorySkippedPages(urls: readonly string[]): Promise<void> {
		return emitErrorAndRetry(
			this,
			'Database.insertInventorySkippedPages',
			async () =>
				await insertInventorySkippedPagesOp(this.#instance, this.#writeRefCaches, urls),
			retrySetting,
		);
	}

	/**
	 * Appends one open (`ended_at = NULL`) row to the `network_outages`
	 * journal. Delegates to {@link insertNetworkOutageOp}.
	 * @param params - The confirmed-outage fields to record.
	 * @returns The autoincremented `id` of the newly-inserted row.
	 */
	async insertNetworkOutage(params: InsertNetworkOutageParams): Promise<number> {
		return emitErrorAndRetry(
			this,
			'Database.insertNetworkOutage',
			async () => await insertNetworkOutageOp(this.#instance, params),
			retrySetting,
		);
	}
	/**
	 * Records a partial scrape failure against the page identified by `url`.
	 * Delegates to {@link insertPageErrorOp}.
	 * @param url - URL of the page being scraped.
	 * @param phase - Scrape phase name (typically `'retryExhausted'`).
	 * @param message - Human-readable failure message.
	 * @param isExternal - Whether the URL is external. Defaults to `false`.
	 */
	async insertPageError(url: string, phase: string, message: string, isExternal = false) {
		return emitErrorAndRetry(
			this,
			'Database.insertPageError',
			async () =>
				await insertPageErrorOp(
					this.#instance,
					this.#writeRefCaches,
					url,
					phase,
					message,
					isExternal,
				),
			retrySetting,
		);
	}

	/**
	 * Inserts a sub-resource into the `resources` table.
	 * Delegates to {@link insertResourceOp}.
	 * @param resource - The resource data to insert.
	 * @param source - Provenance label for new rows. `undefined` leaves the DB DEFAULT (`'crawled'`).
	 */
	async insertResource(resource: Resource, source?: PageSource) {
		return emitErrorAndRetry(
			this,
			'Database.insertResource',
			async () =>
				await insertResourceOp(this.#instance, this.#writeRefCaches, resource, source),
			retrySetting,
		);
	}

	/**
	 * Inserts a referrer relationship between a resource and a page into the
	 * `resources-referrers` table. Delegates to {@link insertResourceReferrersOp}.
	 * @param src - The URL of the resource.
	 * @param pageUrl - The URL of the page that references the resource.
	 */
	async insertResourceReferrers(src: string, pageUrl: string) {
		return emitErrorAndRetry(
			this,
			'Database.insertResourceReferrers',
			async () =>
				await insertResourceReferrersOp(
					this.#instance,
					this.#writeRefCaches,
					src,
					pageUrl,
				),
			retrySetting,
		);
	}

	/**
	 * Every distinct `dedupe_cap_events.shape_key` recorded in this archive.
	 * Delegates to {@link listDedupeCapShapeKeysOp}.
	 * @returns Distinct shape keys already confirmed capped, or `[]` on an
	 *   archive that predates `dedupe_cap_events` or has recorded none.
	 */
	async listDedupeCapShapeKeys(): Promise<string[]> {
		return emitErrorAndRetry(
			this,
			'Database.listDedupeCapShapeKeys',
			async () => await listDedupeCapShapeKeysOp(this.#instance),
			retrySetting,
		);
	}
	/**
	 * Hostnames whose `crawl_errors` history is consistently DNS failures and
	 * for which no recent 2xx-3xx page or resource is recorded.
	 * Delegates to {@link listDnsBurnedHostCandidatesOp}.
	 * @returns Lower-cased hostnames safe to short-circuit.
	 */
	async listDnsBurnedHostCandidates(): Promise<string[]> {
		return emitErrorAndRetry(
			this,
			'Database.listDnsBurnedHostCandidates',
			async () => await listDnsBurnedHostCandidatesOp(this.#instance),
			retrySetting,
		);
	}

	/**
	 * Lists every recorded outage as a resolved {@link OutageWindow}.
	 * Delegates to {@link listNetworkOutagesOp}.
	 * @returns Resolved outage windows, or `[]` on an archive that predates
	 *   `network_outages` or has recorded no outages.
	 */
	async listNetworkOutages(): Promise<OutageWindow[]> {
		return emitErrorAndRetry(
			this,
			'Database.listNetworkOutages',
			async () => await listNetworkOutagesOp(this.#instance),
			retrySetting,
		);
	}
	/**
	 * Appends one row to the `inventory_runs` audit log.
	 * Delegates to {@link recordInventoryRunOp}.
	 * @param meta - The run metadata to record. Only `ran_at` is required.
	 * @returns The autoincremented `id` of the newly-inserted row.
	 */
	async recordInventoryRun(meta: InventoryRunMeta): Promise<number> {
		return emitErrorAndRetry(
			this,
			'Database.recordInventoryRun',
			async () => await recordInventoryRunOp(this.#instance, meta),
			retrySetting,
		);
	}
	/**
	 * Records a redirect edge (source → destination) **without** re-storing the
	 * destination's content. Delegates to {@link recordRedirectOp}.
	 * @param page - HEAD-resolved page data carrying the redirect chain. Its
	 *   `anchorList` / `imageList` are ignored (a redirect source owns no content).
	 * @param source - Inventory provenance forwarded by the orchestrator for
	 *   the redirect-edge fast path. `undefined` keeps the DB DEFAULT
	 *   `'crawled'` on a brand-new destination row.
	 */
	async recordRedirect(page: PageData, source?: PageSource): Promise<void> {
		return emitErrorAndRetry(
			this,
			'Database.recordRedirect',
			async () =>
				await recordRedirectOp(this.#instance, this.#writeRefCaches, page, source),
			retrySetting,
		);
	}
	/**
	 * Replaces the stored analysis violations with a freshly generated set.
	 * Delegates to {@link replaceAnalysisViolationsOp}.
	 * @param violations - Flat violation list from the analyze phase.
	 */
	async replaceAnalysisViolations(
		violations: readonly {
			validator: string;
			severity: string;
			rule: string;
			code?: string | null;
			message: string;
			url: string;
			line?: number | null;
			col?: number | null;
		}[],
	): Promise<void> {
		return emitErrorAndRetry(
			this,
			'Database.replaceAnalysisViolations',
			async () => await replaceAnalysisViolationsOp(this.#instance, violations),
			retrySetting,
		);
	}
	/**
	 * Replaces one page's `page_console_logs` rows with a freshly captured
	 * set of console messages / page errors. Delegates to
	 * {@link replaceConsoleLogsOp}.
	 * @param pageUrl - The originally-requested URL, normalised (`withoutHashAndAuth` form).
	 * @param redirectPaths - The redirect chain hops captured during fetch, in order.
	 * @param entries - The console log entries to persist.
	 */
	async replaceConsoleLogs(
		pageUrl: string,
		redirectPaths: readonly string[],
		entries: readonly ConsoleLogEntry[],
	) {
		return emitErrorAndRetry(
			this,
			'Database.replaceConsoleLogs',
			async () =>
				await replaceConsoleLogsOp(
					this.#instance,
					this.#writeRefCaches,
					pageUrl,
					redirectPaths,
					entries,
				),
			retrySetting,
		);
	}

	/**
	 * Replaces the stored DOM-structure template classification with a
	 * freshly generated set. Delegates to {@link replacePageTemplatesOp}.
	 * @param templateKeysByUrl - Page URL → template key.
	 * @param clusterReasonsByTemplateKey - Template key → cluster-selection
	 *   evidence, if the caller captured it.
	 */
	async replacePageTemplates(
		templateKeysByUrl: ReadonlyMap<string, string>,
		clusterReasonsByTemplateKey?: ReadonlyMap<string, TemplateClusterReason>,
	): Promise<void> {
		return emitErrorAndRetry(
			this,
			'Database.replacePageTemplates',
			async () =>
				await replacePageTemplatesOp(this.#instance, {
					templateKeysByUrl,
					clusterReasonsByTemplateKey,
				}),
			retrySetting,
		);
	}
	/**
	 * Promote previously-external pages whose URL falls under any of the new
	 * scope entries back to a "needs scraping" state.
	 * Delegates to {@link repromoteExternalPagesOp}.
	 * @param scopes - The hostname-indexed scope map after the new roots are merged.
	 * @param options - URL parsing options forwarded to the scope matcher.
	 * @param onProgress - Forwarded to {@link repromoteExternalPagesOp} — see
	 *   that function's docs.
	 * @returns The URLs of the pages that were promoted.
	 */
	async repromoteExternalPages(
		scopes: ReadonlyMap<string, readonly ExURL[]>,
		options?: ParseURLOptions,
		onProgress?: (processed: number, total: number) => void,
	): Promise<string[]> {
		return emitErrorAndRetry(
			this,
			'Database.repromoteExternalPages',
			async () =>
				await repromoteExternalPagesOp(this.#instance, scopes, options, onProgress),
			retrySetting,
		);
	}

	/**
	 * Reset previously-attempted pages that ended in a recoverable failure so a
	 * follow-up crawl can re-fetch them from scratch. Delegates to
	 * {@link resetFailedPagesOp} — see the op for the permanent-failure
	 * exclusion rationale.
	 * @param onProgress - Forwarded to {@link resetFailedPagesOp} — see that
	 *   function's docs.
	 * @returns The URLs of the pages that were reset to pending.
	 */
	async resetFailedPages(
		onProgress?: (processed: number, total: number) => void,
	): Promise<string[]> {
		return emitErrorAndRetry(
			this,
			'Database.resetFailedPages',
			async () => await resetFailedPagesOp(this.#instance, onProgress),
			retrySetting,
		);
	}

	/**
	 * Reset pages matching an operator-supplied URL list back to pending so a
	 * follow-up crawl re-fetches them from scratch. Delegates to
	 * {@link resetPagesByUrlsOp} — see the op for the conservative exclusion
	 * rationale (redirect sources / intentionally-skipped / external pages).
	 * @param urls - URL strings to match, already in `withoutHashAndAuth` form.
	 * @param onProgress - Forwarded to {@link resetPagesByUrlsOp} — see that
	 *   function's docs.
	 * @returns The reset URLs plus the excluded URLs grouped by reason.
	 */
	async resetPagesByUrls(
		urls: readonly string[],
		onProgress?: (processed: number, total: number) => void,
	): Promise<ResetPagesByUrlsResult> {
		return emitErrorAndRetry(
			this,
			'Database.resetPagesByUrls',
			async () => await resetPagesByUrlsOp(this.#instance, urls, onProgress),
			retrySetting,
		);
	}

	/**
	 * Stores the crawl configuration in the `info` table.
	 * Delegates to {@link setConfigOp}.
	 * @param config - The {@link Config} object to store.
	 */
	async setConfig(config: Config) {
		return emitErrorAndRetry(
			this,
			'Database.setConfig',
			async () => await setConfigOp(this.#instance, config),
			retrySetting,
		);
	}

	/**
	 * Marks a page as skipped in the database with the given reason.
	 * Delegates to {@link setSkippedPageOp}.
	 * @param url - The URL of the skipped page.
	 * @param reason - The reason the page was skipped.
	 * @param isExternal - Whether the page is on an external domain. Defaults to `false`.
	 */
	async setSkippedPage(url: string, reason: string, isExternal = false) {
		return emitErrorAndRetry(
			this,
			'Database.setSkippedPage',
			async () =>
				await setSkippedPageOp(
					this.#instance,
					this.#writeRefCaches,
					url,
					reason,
					isExternal,
				),
			retrySetting,
		);
	}

	/**
	 * Assigns natural URL sort order values to all internal pages.
	 * Delegates to {@link setUrlOrderOp}.
	 * @param onProgress - Forwarded to {@link setUrlOrderOp} — see that
	 *   function's docs.
	 */
	async setUrlOrder(onProgress?: (processed: number, total: number) => void) {
		await setUrlOrderOp(this.#instance, onProgress);
	}
	/**
	 * Update the single row in the `info` table with a partial config patch.
	 * Delegates to {@link updateConfigOp}.
	 * @param patch - Partial {@link Config} fields to overwrite. `undefined` values are skipped.
	 */
	async updateConfig(patch: Partial<Config>): Promise<void> {
		return emitErrorAndRetry(
			this,
			'Database.updateConfig',
			async () => await updateConfigOp(this.#instance, patch),
			retrySetting,
		);
	}

	/**
	 * Inserts or updates a crawled page in the database, including its redirect
	 * chain, anchors, images, and (when `writeHtml`) its compressed HTML
	 * snapshot BLOB. Delegates to {@link updatePageOp}.
	 * @param page - The page data to store.
	 * @param writeHtml - When `true`, this call is allowed to insert (or clear)
	 *   the page's HTML blob. `setExternalPage` passes `false` because external
	 *   metadata-only scrapes never carry HTML and must not perturb an already
	 *   stored body.
	 * @param isTarget - Whether this page is a crawl target.
	 * @param source - Provenance label written ONLY when the row is freshly
	 *   inserted. Existing rows keep their original `source`.
	 * @param bodyHash - Precomputed body hash for the page's HTML (see
	 *   `CrawlerEventTypes.page.bodyHash`). `undefined`/`null` falls back to
	 *   computing it from the HTML instead.
	 * @returns The database `pageId` of the inserted/updated row.
	 */
	async updatePage(
		page: PageData,
		writeHtml: boolean,
		isTarget: boolean,
		source?: PageSource,
		bodyHash?: Buffer | null,
	): Promise<number> {
		return emitErrorAndRetry(
			this,
			'Database.updatePage',
			async () =>
				await updatePageOp(
					this.#instance,
					this.#writeRefCaches,
					page,
					writeHtml,
					isTarget,
					source,
					bodyHash,
				),
			retrySetting,
		);
	}

	/**
	 * Initializes the database schema if tables do not exist, then runs
	 * lightweight migrations; in read-only mode both are skipped.
	 * Delegates to {@link initOp}.
	 * @param readOnly - When true, skip schema init + migrations.
	 * @param onLog - Forwarded to {@link initOp} — see
	 *   {@link DatabaseOption.onLog}'s docs.
	 */
	async #init(readOnly: boolean, onLog?: (message: string) => void) {
		await initOp(this.#instance, readOnly, onLog);
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
		await db.#init(options.readOnly ?? false, options.onLog);
		return db;
	}
}
