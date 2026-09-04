import type { TemplateClusterReason } from './db-ops/analysis/types.js';
import type {
	Config,
	InsertDedupeCapEventParams,
	InsertNetworkOutageParams,
	ListReconcileRunMeta,
	PageSource,
} from './types.js';
import type { OutageWindow } from '../is-within-outage-window.js';
import type { PageData, CrawlerError, Resource } from '../utils/types/types.js';
import type { ConsoleLogEntry } from '@d-zero/beholder';
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
import { outputBinary } from './filesystem/output-binary.js';
import { peekTarTopDir } from './filesystem/peek-tar-top-dir.js';
import { remove } from './filesystem/remove.js';
import { rename } from './filesystem/rename.js';
import { tar } from './filesystem/tar.js';
import { untar } from './filesystem/untar.js';
import { safePath } from './safe-path.js';

/**
 * Main archive class for creating, opening, resuming, and writing Nitpicker
 * archive files (`.nitpicker`).
 *
 * An Archive wraps a SQLite database into a tar archive. HTML bodies live
 * inside the same DB as zstd-compressed BLOBs (see #75), so `db.sqlite` is
 * normally the tar's only entry — but it is not the only entry the format
 * allows: {@link ArchiveAccessor.setData} (namespace-scoped analyze output)
 * and {@link Archive.saveInventorySourceList} (a saved `--inventory`
 * source list) add plain files alongside it. It extends
 * {@link ArchiveAccessor} to provide read access to stored data.
 *
 * Use the static factory methods ({@link Archive.create}, {@link Archive.open},
 * {@link Archive.resume}, {@link Archive.connect}) to obtain instances.
 * The constructor is private. Implements `Symbol.asyncDispose` (inherited
 * from {@link ArchiveAccessor}) so callers can use `await using` instead of
 * a manual `try`/`finally` around {@link close}.
 * @example
 * await using archive = await Archive.create({ filePath: '/path/to/site.nitpicker' });
 * await archive.setConfig(config);
 * const pageId = await archive.setPage(pageData);
 * // Writes the `.nitpicker` tar (if absent), removes tmpDir, releases the
 * // lock — all on scope exit, whether by fallthrough or thrown error.
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
	 * Adds onto the `rejected_count` of a shape's `dedupe_cap_events` row,
	 * looked up by `shape_key` rather than `id` — used for a shape that
	 * capped in an earlier session (preloaded into `DedupeCapTracker`'s
	 * sticky set) and so has no event id from the current session.
	 *
	 * Thin facade over {@link Database.accumulateDedupeCapRejectedCount}.
	 * @param shapeKey - The capped shape whose rejection count to accumulate.
	 * @param rejectedCount - Additional anchors rejected for this shape in the current session.
	 */
	async accumulateDedupeCapRejectedCount(
		shapeKey: string,
		rejectedCount: number,
	): Promise<void> {
		dbLog(
			'Accumulate dedupe cap rejected count shapeKey=%s rejectedCount=%d',
			shapeKey,
			rejectedCount,
		);
		return await this.#db.accumulateDedupeCapRejectedCount(shapeKey, rejectedCount);
	}
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
	 * Closes an outage row by stamping `ended_at` — a no-op if already closed.
	 *
	 * Thin facade over {@link Database.closeNetworkOutage}.
	 * @param id - The `network_outages.id` to close.
	 * @param endedAt - Epoch ms the outage is considered to have ended.
	 */
	async closeNetworkOutage(id: number, endedAt: number): Promise<void> {
		dbLog('Close network outage id=%d endedAt=%d', id, endedAt);
		return await this.#db.closeNetworkOutage(id, endedAt);
	}
	/**
	 * Finalizes a `dedupe_cap_events` row by stamping `rejected_count` — a
	 * no-op if already finalized.
	 *
	 * Thin facade over {@link Database.finalizeDedupeCapEvent}.
	 * @param id - The `dedupe_cap_events.id` to finalize.
	 * @param rejectedCount - Number of anchors rejected for this shape after it capped.
	 */
	async finalizeDedupeCapEvent(id: number, rejectedCount: number): Promise<void> {
		dbLog('Finalize dedupe cap event id=%d rejectedCount=%d', id, rejectedCount);
		return await this.#db.finalizeDedupeCapEvent(id, rejectedCount);
	}

	/**
	 * Retrieves the current crawling state, including lists of scraped and pending URLs.
	 * @returns An object with `scraped` and `pending` URL arrays.
	 */
	async getCrawlingState() {
		return this.#db.getCrawlingState();
	}
	/**
	 * Retrieves the `info.createdCwd` value stamped when this stub was
	 * created — see {@link Archive.resume} for how it is used.
	 * @returns The recorded cwd, or `null` if never stamped.
	 */
	async getCreatedCwd(): Promise<string | null> {
		return this.#db.getCreatedCwd();
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
	 * Appends one row (`rejected_count = NULL`) to the `dedupe_cap_events`
	 * journal.
	 *
	 * Thin facade over {@link Database.insertDedupeCapEvent}.
	 * @param params - The newly-capped shape's fields to record.
	 * @returns The autoincremented `id` of the inserted row.
	 */
	async insertDedupeCapEvent(params: InsertDedupeCapEventParams): Promise<number> {
		dbLog('Insert dedupe cap event: shapeKey=%s', params.shapeKey);
		return await this.#db.insertDedupeCapEvent(params);
	}
	/**
	 * Pre-insert inventory non-HTML URLs as `source='inventory-seed'`
	 * placeholders in the `resources` table — the non-HTML counterpart of
	 * {@link Archive.insertInventorySeeds}. Rows are committed in chunked
	 * bulk inserts (500 per round-trip) rather than per-URL awaits — a
	 * per-URL loop would keep a 50k-URL inventory list inside the `.bak`
	 * window for minutes instead of seconds.
	 *
	 * Thin facade over {@link Database.insertInventoryResources}.
	 * `ExURL.href` is the storage key for `resources.url` (matches what
	 * `insertResource` writes for the per-URL path); we normalise here so
	 * the orchestrator stays decoupled from the storage form.
	 * @param urls - Non-HTML inventory URLs to record. No-op when empty.
	 */
	async insertInventoryResources(urls: readonly ExURL[]): Promise<void> {
		if (urls.length === 0) {
			return;
		}
		dbLog('Insert inventory resources: %d URL(s)', urls.length);
		await this.#db.insertInventoryResources(urls.map((u) => u.href));
	}
	/**
	 * Pre-insert inventory HTML seeds as `scraped=0`, `source='inventory-seed'`
	 * placeholder pages so the URL is durably tracked in the archive **before**
	 * the scrape phase starts. Thin facade over
	 * {@link Database.insertInventorySeeds} — see that method's JSDoc for the
	 * Ctrl+C-tolerance rationale and the `getCrawlingState` interaction.
	 *
	 * `ExURL` inputs are normalised to `withoutHashAndAuth` here so the storage
	 * key matches what `resolveContentItemId` writes for crawled rows, keeping the
	 * crawled-wins downgrade and the existing-URL filter (`getExistingPageUrls`)
	 * lookups consistent.
	 * @param urls - HTML seed URLs to pre-insert. No-op when empty.
	 */
	async insertInventorySeeds(urls: readonly ExURL[]): Promise<void> {
		if (urls.length === 0) {
			return;
		}
		dbLog('Insert inventory seeds: %d URL(s)', urls.length);
		await this.#db.insertInventorySeeds(urls.map((u) => u.withoutHashAndAuth));
	}

	/**
	 * Records exclude-matched inventory URLs as terminal skipped pages —
	 * the same `is_skipped=1, skip_reason='excluded'` state the normal
	 * crawl's fetch-time gate writes for link-discovered excluded URLs,
	 * labelled `source='inventory-seed'`. Thin facade over
	 * {@link Database.insertInventorySkippedPages} — see the underlying
	 * op's JSDoc for the parity rationale and crawled-wins safety.
	 *
	 * `ExURL` inputs are normalised to `withoutHashAndAuth` here for the
	 * same storage-key consistency reason as {@link insertInventorySeeds}.
	 * @param urls - Exclude-matched URLs to record. No-op when empty.
	 */
	async insertInventorySkippedPages(urls: readonly ExURL[]): Promise<void> {
		if (urls.length === 0) {
			return;
		}
		dbLog('Insert inventory skipped pages: %d URL(s)', urls.length);
		await this.#db.insertInventorySkippedPages(urls.map((u) => u.withoutHashAndAuth));
	}
	/**
	 * Appends one open row to the `network_outages` journal.
	 *
	 * Thin facade over {@link Database.insertNetworkOutage} — see
	 * {@link recordListReconcileRun}'s docstring for why this indirection exists.
	 * @param params - The confirmed-outage fields to record.
	 * @returns The autoincremented `id` of the inserted row.
	 */
	async insertNetworkOutage(params: InsertNetworkOutageParams): Promise<number> {
		dbLog(
			'Insert network outage: startedAt=%d probeHost=%s',
			params.startedAt,
			params.probeHost,
		);
		return await this.#db.insertNetworkOutage(params);
	}

	/**
	 * Every distinct `dedupe_cap_events.shape_key` recorded in this archive.
	 * Consumed by `CrawlerOrchestrator` to preload `DedupeCapTracker`'s
	 * sticky set on `--resume` / `--append` / `--retry-failed` /
	 * `--inventory`, mirroring {@link listDnsBurnedHostCandidates}'s
	 * writer-only exposure.
	 * @returns Distinct shape keys already confirmed capped.
	 */
	async listDedupeCapShapeKeys(): Promise<string[]> {
		return this.#db.listDedupeCapShapeKeys();
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
	 * Lists every recorded outage as a resolved {@link OutageWindow}.
	 *
	 * Thin facade over {@link Database.listNetworkOutages}.
	 * @returns Resolved outage windows, or `[]` if none have been recorded.
	 */
	async listNetworkOutages(): Promise<OutageWindow[]> {
		return await this.#db.listNetworkOutages();
	}
	/**
	 * Appends one row to the `list_reconcile_runs` audit log.
	 *
	 * Thin facade over {@link Database.recordListReconcileRun} — keeps the
	 * orchestrator decoupled from the knex layer and gives a single
	 * write entry point that future Archive-level concerns (locking,
	 * mirror sync, etc.) can hook into without touching every caller.
	 * @param meta - The run metadata. Only `ran_at` is required.
	 * @returns The autoincremented `id` of the inserted row.
	 */
	async recordListReconcileRun(meta: ListReconcileRunMeta): Promise<number> {
		dbLog('Record list reconcile run: %s', meta.list_label ?? meta.ran_at);
		return await this.#db.recordListReconcileRun(meta);
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
	 * Replaces the archive's analysis violations with a fresh SQL-backed set.
	 *
	 * Thin facade over {@link Database.replaceAnalysisViolations}; kept on
	 * `Archive` so the analyze pipeline can persist violations without
	 * reaching into the low-level database class directly.
	 * @param violations - Flat analyze violations.
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
		await this.#db.replaceAnalysisViolations(violations);
	}

	/**
	 * Replaces the archive's DOM-structure template classification
	 * (`--templates`) with a fresh SQL-backed set.
	 *
	 * Thin facade over {@link Database.replacePageTemplates}; kept on
	 * `Archive` so the analyze pipeline can persist template keys without
	 * reaching into the low-level database class directly.
	 * @param templateKeysByUrl - Page URL → template key, as produced by
	 *   `@nitpicker/core`'s `classifyPageTemplates`.
	 * @param clusterReasonsByTemplateKey - Template key → cluster-selection
	 *   evidence, if the caller captured it. Omitting this always clears the
	 *   previously-stored reasons too — "no reason" means "not captured for
	 *   this run", never "carry over the previous run's reasons".
	 */
	async replacePageTemplates(
		templateKeysByUrl: ReadonlyMap<string, string>,
		clusterReasonsByTemplateKey?: ReadonlyMap<string, TemplateClusterReason>,
	): Promise<void> {
		await this.#db.replacePageTemplates(templateKeysByUrl, clusterReasonsByTemplateKey);
	}

	/**
	 * Promote previously-external pages that now fall under the (possibly extended)
	 * scope back to a pending state so that the crawler re-scrapes them as fully
	 * internal pages on the next pass.
	 * @param scopes - Hostname-indexed scope map representing the new scope.
	 * @param options - URL parsing options forwarded to the scope-entry lookup.
	 * @param onProgress - Forwarded to {@link Database.repromoteExternalPages}
	 *   — see that method's docs.
	 * @returns The URLs that were repromoted.
	 */
	async repromoteExternalPages(
		scopes: ReadonlyMap<string, readonly ExURL[]>,
		options?: ParseURLOptions,
		onProgress?: (processed: number, total: number) => void,
	) {
		dbLog('Repromote external pages with %d hostnames in scope', scopes.size);
		return this.#db.repromoteExternalPages(scopes, options, onProgress);
	}
	/**
	 * Reset previously-failed pages back to pending so a follow-up crawl re-fetches them.
	 *
	 * Delegates to {@link Database.resetFailedPages}. See that method for the
	 * exact failure criteria (missing status / content type, or a 5xx status).
	 * @param onProgress - Forwarded to {@link Database.resetFailedPages} —
	 *   see that method's docs.
	 * @returns The URLs of the pages that were reset to pending.
	 */
	async resetFailedPages(onProgress?: (processed: number, total: number) => void) {
		dbLog('Reset failed pages back to pending');
		return this.#db.resetFailedPages(onProgress);
	}
	/**
	 * Reset pages matching an operator-supplied URL list back to pending so a
	 * follow-up crawl re-fetches them from scratch.
	 *
	 * Delegates to {@link Database.resetPagesByUrls}. See that method for the
	 * conservative exclusion rules (redirect sources / intentionally-skipped /
	 * external pages are matched but not reset).
	 * @param urls - URL strings to match, already in `withoutHashAndAuth` form.
	 * @param onProgress - Forwarded to {@link Database.resetPagesByUrls} — see
	 *   that method's docs.
	 * @returns The reset URLs plus the excluded URLs grouped by reason.
	 */
	async resetPagesByUrls(
		urls: readonly string[],
		onProgress?: (processed: number, total: number) => void,
	) {
		dbLog('Reset %d URL-list-matched page(s) back to pending', urls.length);
		return this.#db.resetPagesByUrls(urls, onProgress);
	}
	/**
	 * Persists the raw bytes of an `--inventory` source URL list into the
	 * archive's tar payload, at `inventory/<sha256>.txt`.
	 *
	 * The file name is the content hash rather than the original file name:
	 * re-applying the same list is then a no-op write (`fs.writeFile`
	 * overwrites identical bytes), and the original name — which may embed a
	 * client/project identifier — is never retained (the archive already
	 * omits the source file's absolute path for the same reason; see
	 * `CrawlerOrchestrator.inventory`'s `source` param).
	 *
	 * This bypasses the namespace-scoped {@link ArchiveAccessor.setData} API
	 * (that one is reserved for analyze plugins and requires a namespace) —
	 * this always lands under the fixed `inventory/` prefix regardless of
	 * how this accessor was constructed. Callers that need to read the
	 * saved list back can use the inherited `getData(`inventory/${sha256}`,
	 * 'txt')`, since it resolves to the same path when no namespace is set.
	 *
	 * No entry is ever removed here — same accepted gap as `page_html_blobs`
	 * (a future #23 GC pass will sweep unreachable hashes across both). A
	 * source list that differs byte-for-byte on every run (e.g. a
	 * regenerated doc-root export with fresh timestamps) adds one entry per
	 * run with no pruning of superseded ones.
	 * @param sha256 - Lower-case hex SHA-256 digest of `bytes` (used as the file name).
	 * @param bytes - The exact bytes of the source list file, written verbatim.
	 */
	async saveInventorySourceList(sha256: string, bytes: Buffer): Promise<void> {
		const filePath = safePath(this.tmpDir, 'inventory', `${sha256}.txt`);
		await outputBinary(filePath, bytes);
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
	 * Replaces one page's captured console messages / page errors in the
	 * archive database.
	 * @param pageUrl - The originally-requested URL, normalised (`withoutHashAndAuth` form).
	 * @param redirectPaths - The redirect chain hops captured during fetch, in order.
	 * @param entries - The console log entries to persist.
	 */
	async setConsoleLogs(
		pageUrl: string,
		redirectPaths: readonly string[],
		entries: readonly ConsoleLogEntry[],
	) {
		dbLog('Set console logs: %d entries on %s', entries.length, pageUrl);
		await this.#db.replaceConsoleLogs(pageUrl, redirectPaths, entries);
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
	 * @param bodyHash - Precomputed body hash for the page's HTML (see
	 *   `CrawlerEventTypes.page.bodyHash`). `undefined`/`null` falls back to
	 *   computing it from the HTML instead.
	 * @returns The database ID of the stored page.
	 */
	async setPage(
		pageInfo: PageData,
		source?: PageSource,
		bodyHash?: Buffer | null,
	): Promise<number> {
		dbLog('Set page: %s', pageInfo.url.href);
		return await this.#db.updatePage(pageInfo, true, pageInfo.isTarget, source, bodyHash);
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
	 * @param onProgress - Forwarded to {@link Database.setUrlOrder} — see that
	 *   method's docs.
	 */
	async setUrlOrder(onProgress?: (processed: number, total: number) => void) {
		dbLog("Pages didn't have `order` field. So set URL order.");
		await this.#db.setUrlOrder(onProgress);
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
	 * basename, and tars the **entire tmpDir**. `db.sqlite` is normally the
	 * only entry (HTML lives as BLOBs in the DB, not a `snapshot-html.zip`),
	 * but a namespace-scoped `setData` write (analyze output) or
	 * `saveInventorySourceList` (a saved `--inventory` source list) adds
	 * extra files under tmpDir that get tarred right alongside it.
	 *
	 * This is why every writer path that reaches `write()` must open with
	 * `openPluginData: true` — `Archive.open`'s default extracts only
	 * `db.sqlite`, so a re-crawl (`append` / `inventory` / `retryFailed`)
	 * opened without it would tar back a tmpDir missing those extra files,
	 * silently dropping them from the rewritten archive.
	 * @param options - Optional write settings.
	 * @param options.onTarProgress - Called as archive bytes are written
	 *   during the tar step, with the bytes written so far and the estimated
	 *   total (issue #294: tarring a large archive takes minutes, and
	 *   without this the CLI shows nothing until `write` returns). Omit for
	 *   a silent write (the default).
	 * @param options.onStep - Called once at the start of each of this
	 *   method's four steps (issue #294): `checkpoint` (WAL fold-back —
	 *   single synchronous PRAGMA, no countable progress) and `remove`
	 *   (deleting the tarred-away tmpDir) have no progress signal of their
	 *   own, so without this a large archive's write looks frozen between
	 *   the `tar` step's byte updates and completion. `rename` is nearly
	 *   instant (same-filesystem directory move) but included for
	 *   completeness — a caller displaying phase labels shouldn't have a
	 *   gap where the operation is silently between named steps.
	 */
	async write(options?: {
		onTarProgress?: (writtenBytes: number, totalBytes: number) => void;
		onStep?: (step: 'checkpoint' | 'rename' | 'tar' | 'remove') => void;
	}) {
		saveLog('Starts: %s', this.#filePath);
		// `.nitpicker` files are routinely shared between users — scrub the
		// stub-local `createdCwd` (see `Config.createdCwd`'s JSDoc) before it
		// gets folded into `db.sqlite` and tarred, so a packaged archive never
		// carries another user's local absolute path. Bundled into the
		// `checkpoint` step below (a single UPDATE ahead of the WAL fold-back)
		// rather than its own `onStep` phase — both are near-instant and
		// reporting them separately would add a phase label for no visible
		// wait.
		await this.#db.updateConfig({ createdCwd: null });
		options?.onStep?.('checkpoint');
		await this.#db.checkpoint();
		const filePathWithoutExt = path.resolve(
			path.dirname(this.#filePath),
			path.basename(this.#filePath, path.extname(this.#filePath)),
		);
		saveLog('Rename temporary dir: %s to %s', this.#tmpDir, filePathWithoutExt);
		options?.onStep?.('rename');
		await rename(this.#tmpDir, filePathWithoutExt, true);
		saveLog('Tar temporary dir to file: %s to %s', filePathWithoutExt, this.#filePath);
		options?.onStep?.('tar');
		await tar(filePathWithoutExt, this.#filePath, options?.onTarProgress);
		saveLog('Remove temporary dir: %s', filePathWithoutExt);
		options?.onStep?.('remove');
		await remove(filePathWithoutExt);
		saveLog('Done: %s', this.#filePath);
	}
	/**
	 * Worker for {@link close}. Performs the destructive prologue
	 * (write or remove), drops the DB handle via the base class, then
	 * releases the lock in a `finally` so the lock never leaks even on
	 * partial failure.
	 * @param options - See {@link close}.
	 * @param options.timeoutMs
	 * @param options.onRecoveryStart
	 * @param options.onTarProgress
	 * @param options.onStep
	 */
	async #runFullClose(options?: {
		timeoutMs?: number;
		onRecoveryStart?: () => void;
		onTarProgress?: (writtenBytes: number, totalBytes: number) => void;
		onStep?: (step: 'checkpoint' | 'rename' | 'tar' | 'remove') => void;
	}): Promise<void> {
		log('Closing');
		try {
			if (!exists(this.#filePath)) {
				log("Save the file because it doesn't exist");
				options?.onRecoveryStart?.();
				await this.write(options);
			} else if (exists(this.#tmpDir)) {
				log('Remove temporary dir');
				await remove(this.#tmpDir);
			}
			await super.close({ timeoutMs: options?.timeoutMs });
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
	 * `options.readOnly: false` is a narrow escape hatch for opening a
	 * second, writable connection to a `tmpDir` the caller's own process
	 * already owns and extracted itself. The one production caller is the
	 * viewer-read-model worker thread (`@nitpicker/query`'s
	 * `viewer-read-model-worker-entry.ts`, issue #294): the parent thread
	 * holds the archive via `Archive.open` (lock included — worker threads
	 * share the parent's PID, so the PID-based `acquireArchiveLock` guard
	 * stays valid), sits idle awaiting the worker, and re-tars the tmpDir
	 * afterward. What this hatch must NEVER target is a live/interrupted
	 * crawl tmpDir owned by a *different* process (the stub-mode
	 * `ArchiveManager.open` path attaches to exactly such directories, and
	 * must stay read-only): writable connects run the self-healing
	 * migrations, and mutating a directory out from under its owner is how
	 * archives corrupt. A read-only open (`Archive.openCached`/
	 * `ArchiveManager.open`) must never take this path itself — blocking or
	 * writing during what must be a read-only open is forbidden (issue
	 * #177). Any new caller is responsible for its own coordination with
	 * the tmpDir's owner (see `acquireArchiveLock` for the cross-process
	 * case) — this method does not acquire any lock itself.
	 * @param tmpDir - The path to the temporary directory containing the database.
	 * @param namespace - An optional namespace for scoping data access within the archive.
	 * @param options - Connection options.
	 * @param options.readOnly - Defaults to `true`. Pass `false` to obtain a
	 *   writable accessor against a tmpDir the calling process itself owns.
	 * @returns An ArchiveAccessor instance for querying the archive data.
	 * @example
	 * // Default (read-only) — safe for stub mode and cache reads:
	 * const accessor = await Archive.connect(tmpDir);
	 * @example
	 * // Writable escape hatch — only against a tmpDir this process owns
	 * // (e.g. the viewer-read-model worker thread reconnecting to the
	 * // parent's Archive.open extraction):
	 * const writable = await Archive.connect(ownTmpDir, null, { readOnly: false });
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
	 * @param onExtractProgress - Forwarded to {@link extractArchiveToCache} —
	 *   see that function's docs for the cache-hit/miss contract.
	 * @returns A read-only {@link ArchiveAccessor} backed by the cache directory.
	 * @example
	 * ```ts
	 * await using accessor = await Archive.openCached('/path/to/site.nitpicker');
	 * const summary = await getSummary(accessor);
	 * // tears down DB handle on scope exit; cacheDir persists.
	 * ```
	 */
	static async openCached(
		filePath: string,
		namespace: string | null = null,
		onExtractProgress?: (readBytes: number, totalBytes: number) => void,
	): Promise<ArchiveAccessor> {
		const cacheRoot = getArchiveCacheRoot();
		const cacheKey = await computeArchiveCacheKey(filePath);
		const cacheDir = resolveArchiveCacheDir(cacheRoot, cacheKey, filePath);
		log('Open cached: %s (cacheDir=%s)', filePath, cacheDir);
		await extractArchiveToCache(
			filePath,
			cacheRoot,
			cacheDir,
			cacheKey,
			onExtractProgress,
		);
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
		const { filePath, openPluginData, onExtractProgress, onLog } = options;
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
				onProgress: onExtractProgress,
			});
			const extractedDir = path.resolve(cwd, innerDirName);
			log('Move directory: %s to %s', extractedDir, tmpDir);
			await rename(extractedDir, tmpDir, true);
			return await Archive.#init(filePath, tmpDir, releaseLock, onLog);
		} catch (error) {
			await releaseLock();
			throw error;
		}
	}
	/**
	 * Resumes an archive from an existing temporary directory
	 * (e.g., after an interrupted crawl session).
	 * @param targetPath - The path to the temporary directory to resume from.
	 * @param onLog - Forwarded to {@link Database.connect} — see
	 *   {@link ArchiveOpenOptions.onLog}'s docs (this writable reconnect
	 *   runs the same self-healing migrations `Archive.open` does).
	 * @returns An Archive instance reconnected to the existing data.
	 * @throws {Error} If the specified path is not a directory.
	 */
	static async resume(targetPath: string, onLog?: (message: string) => void) {
		log('Resume: %s', targetPath);
		if (await isDir(targetPath)) {
			const tmpDir = targetPath;
			const releaseLock = await acquireArchiveLock(tmpDir);
			try {
				const db = await Archive.#connectDB(tmpDir, { onLog });
				const name =
					(await db.getName()) ||
					path.basename(targetPath).replace(Archive.TMP_DIR_PREFIX, '');
				// Reconstruct the output path from the cwd the interrupted
				// session was originally started from (see `Config.createdCwd`),
				// not this invocation's own `process.cwd()` — `crawl --resume
				// <stub>` is routinely run from a different directory than the
				// original `crawl`/`--append`/etc. call. Falls back to this
				// invocation's cwd for a stub that predates this column.
				const createdCwd = await db.getCreatedCwd();
				const filePath = path.resolve(
					createdCwd ?? process.cwd(),
					name + '.' + Archive.FILE_EXTENSION,
				);
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
	 * @param options.onLog
	 */
	static async #connectDB(
		tmpDir: string,
		options?: { readOnly?: boolean; onLog?: (message: string) => void },
	) {
		const dbPath = path.resolve(tmpDir, Archive.SQLITE_DB_FILE_NAME);
		dbLog('connects database: %s (readOnly=%s)', dbPath, options?.readOnly ?? false);
		return await Database.connect({
			filename: dbPath,
			readOnly: options?.readOnly,
			onLog: options?.onLog,
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
	 * @param onLog - Forwarded to {@link Database.connect} — see
	 *   {@link ArchiveOpenOptions.onLog}'s docs.
	 */
	static async #init(
		filePath: string,
		tmpDir: string,
		releaseLock: () => Promise<void>,
		onLog?: (message: string) => void,
	) {
		const db = await Archive.#connectDB(tmpDir, { onLog });
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
	 * @param options - Optional close settings. `timeoutMs` is accepted for
	 *   compatibility with {@link ArchiveAccessor.close}'s signature (forwarded
	 *   to the base `super.close()` call below); the rest are progress
	 *   callbacks (issue #294) forwarded to {@link write} when this call ends
	 *   up taking the recovery-write branch (the archive file doesn't exist
	 *   yet).
	 * @param options.timeoutMs - See {@link ArchiveAccessor.close}.
	 * @param options.onRecoveryStart - Called once, only when this `close()`
	 *   is about to write the archive because the file doesn't exist on
	 *   disk yet — e.g. a caller's own explicit `write()` threw before
	 *   finishing, or was never called at all. Without this, a listener
	 *   that already tore down its display after that earlier failure has
	 *   no way to know a second, recovery write is happening.
	 * @param options.onTarProgress - See {@link write}.
	 * @param options.onStep - See {@link write}.
	 */
	override async close(options?: {
		timeoutMs?: number;
		onRecoveryStart?: () => void;
		onTarProgress?: (writtenBytes: number, totalBytes: number) => void;
		onStep?: (step: 'checkpoint' | 'rename' | 'tar' | 'remove') => void;
	}): Promise<void> {
		if (this.#closeOnce) {
			return this.#closeOnce;
		}
		this.#closeOnce = this.#runFullClose(options);
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
	/**
	 * When `false` (the default), only `db.sqlite` is extracted into tmpDir.
	 * When `true`, every tar entry is extracted, including non-namespace
	 * files written via {@link ArchiveAccessor.setData} (analyze output) or
	 * {@link Archive.saveInventorySourceList} (a saved `--inventory` source
	 * list).
	 *
	 * Every writer path that later calls {@link Archive.write} MUST pass
	 * `true`: `write()` re-tars whatever is currently in tmpDir, so a
	 * re-crawl (`append` / `inventory` / `retryFailed`) opened with the
	 * default would tar back a tmpDir missing those extra files, silently
	 * dropping them from the rewritten archive.
	 */
	openPluginData?: boolean;
	/**
	 * Called as archive bytes are consumed during the initial tar
	 * extraction, with the bytes read so far and the archive's total size
	 * (issue #294: a large archive takes minutes to extract, and without
	 * this the CLI shows nothing at all until `open` returns). Byte
	 * granularity is the read-stream chunk size — throttle in the callback
	 * for coarser display updates. Omit for a silent extraction (the
	 * default).
	 */
	onExtractProgress?: (readBytes: number, totalBytes: number) => void;
	/**
	 * Called instead of `console.error` for self-healing schema migration
	 * notices that fire while opening a legacy archive (issue #294) —
	 * forwarded to {@link Database.connect}'s `onLog`. Without this, a
	 * migration notice can print mid-redraw of a caller's `Lanes`/`TaskList`
	 * display, corrupting its cursor tracking. Omit to fall back to
	 * `console.error` (the pre-#294 behavior).
	 */
	onLog?: (message: string) => void;
};
