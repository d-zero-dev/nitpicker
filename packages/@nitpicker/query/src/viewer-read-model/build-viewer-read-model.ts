import type { BuildViewerReadModelOptions, PageSource } from '../types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { buildHeaderPresenceSelects } from '../build-header-presence-selects.js';
import { classifyContentType } from '../classify-content-type.js';
import { computeIsolatedClusters } from '../compute-isolated-clusters.js';
import { excludeSkippedPages } from '../exclude-skipped-pages.js';
import { getErrorKinds } from '../get-error-kinds.js';
import { getSummary } from '../get-summary.js';

import { backfillAliasOfId } from './backfill-alias-of-id.js';
import { backfillAnalysisViolationsFromJson } from './backfill-analysis-violations-from-json.js';
import { backfillBodyHashFromHtmlBlobs } from './backfill-body-hash-from-html-blobs.js';
import { backfillDedupeCapEventId } from './backfill-dedupe-cap-event-id.js';
import { buildDirectoryTreeRows } from './build-directory-tree-rows.js';
import { buildIsolatedReadModelRows } from './build-isolated-read-model-rows.js';
import { buildPageNaturalUrlRankMap } from './build-page-natural-url-rank-map.js';
import { buildPageUrlRankMap } from './build-page-url-rank-map.js';
import { buildTechnologyDirectoryStatsRows } from './build-technology-directory-stats-rows.js';
import { buildTechnologySummaryRows } from './build-technology-summary-rows.js';
import { computeAnchorFactRows } from './compute-anchor-fact-rows.js';
import { computeDuplicateGroupPageRows } from './compute-duplicate-group-page-rows.js';
import { computeDuplicateGroupRows } from './compute-duplicate-group-rows.js';
import { computeErrorKindInsertRows } from './compute-error-kind-insert-rows.js';
import { computeGraphReadModelRows } from './compute-graph-read-model-rows.js';
import { computeHeaderCheckInsertRows } from './compute-header-check-insert-rows.js';
import { computeImageInsertRows } from './compute-image-insert-rows.js';
import { computeMismatchInsertRows } from './compute-mismatch-rows.js';
import { computePageFacetBuckets } from './compute-page-facet-buckets.js';
import { computeResourceInsertRows } from './compute-resource-rows.js';
import { createViewerReadModelIndexes } from './create-viewer-read-model-indexes.js';
import { createViewerReadModelTables } from './create-viewer-read-model-tables.js';
import { deriveExternalLinkSummaryRows } from './derive-external-link-summary-rows.js';
import { dropViewerReadModelTables } from './drop-viewer-read-model-tables.js';
import { NULL_STATUS_SENTINEL } from './null-status-sentinel.js';
import { upsertExternalLinkRows } from './upsert-external-link-rows.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model-schema-version.js';

/** Number of rows written per `INSERT` statement while populating `viewer_pages`. */
const INSERT_CHUNK_SIZE = 500;

/**
 * Row shape read from the write-model `pages` table while populating
 * `viewer_pages`. Column names match `pages` verbatim (see
 * `@nitpicker/crawler`'s `init-schema.ts` and this package's
 * `list-pages.ts`, which filters/sorts on the same columns).
 */
interface PagesSourceRow {
	/** `pages.id` — becomes `viewer_pages.page_id`. */
	id: number;
	/** The page's absolute URL. */
	url: string;
	/** The page's `<title>` text, or `null` when absent. */
	title: string | null;
	/** HTTP status code, or `null` for not-yet-classified/errored rows. */
	status: number | null;
	/** Raw `Content-Type` response header value, or `null`. */
	contentType: string | null;
	/**
	 * `1`/`0` when known, `null` on legacy rows written before this column
	 * was backfilled (the `pages.isExternal` column has no `NOT NULL`
	 * constraint — see `init-schema.ts`).
	 */
	isExternal: number | null;
	/** The page's meta description text, or `null` when absent. */
	description: string | null;
	/** The page's `og:title` text, or `null` when absent. */
	og_title: string | null;
	/**
	 * `1`/`0` when known, `null` when no `<meta name="robots">` tag was
	 * ever parsed (the `pages.robots_noindex` column has no `NOT NULL`
	 * constraint — see `init-schema.ts`).
	 */
	robots_noindex: number | null;
	/** Denormalised count of Wappalyzer tags detected on the page. */
	tag_count: number | null;
	/** Denormalised count of JSON-LD / SpeculationRules entries on the page. */
	jsonld_count: number | null;
	/** Denormalised beholder MainContentsData word count, or `null` when unrendered. */
	main_content_word_count: number | null;
	/** Denormalised beholder MainContentsData body word count, or `null` when unrendered. */
	main_content_body_word_count: number | null;
	/** Denormalised heading count within the main region, or `null` when unrendered. */
	main_content_heading_count: number | null;
	/** Denormalised image count within the main region, or `null` when unrendered. */
	main_content_image_count: number | null;
	/** Denormalised table count within the main region, or `null` when unrendered. */
	main_content_table_count: number | null;
	/** Denormalised button count within the main region, or `null` when unrendered. */
	main_content_button_count: number | null;
	/** Denormalised iframe count within the main region, or `null` when unrendered. */
	main_content_iframe_count: number | null;
	/** Denormalised video count within the main region, or `null` when unrendered. */
	main_content_video_count: number | null;
	/** Denormalised audio count within the main region, or `null` when unrendered. */
	main_content_audio_count: number | null;
	/** Denormalised canvas count within the main region, or `null` when unrendered. */
	main_content_canvas_count: number | null;
	/** Denormalised custom-element count within the main region, or `null` when unrendered/unknown. */
	main_content_custom_element_count: number | null;
	/** Denormalised desktop-compact scroll height, or `null` when unrendered. */
	scroll_height_desktop: number | null;
	/** Denormalised mobile-small scroll height, or `null` when unrendered. */
	scroll_height_mobile: number | null;
	/**
	 * Denormalised `pageerror`+`error` console log occurrence count (issue
	 * #228), or `null` on a page that predates the feature / has never been
	 * re-scraped since.
	 */
	console_error_count: number | null;
	/** Provenance label — see {@link PageSource}. Always non-null (`NOT NULL DEFAULT 'crawled'` in `init-schema.ts`). */
	source: PageSource;
	/**
	 * `<html lang>` tag value, or `null`/`''` when absent. Feeds both
	 * `computePageFacetBuckets`'s `lang` facet tally and the persisted
	 * `viewer_pages.lang` filter column.
	 */
	lang: string | null;
	/** `header_flags.has_csp`, coalesced to `0` when the page has no `header_set_id` — see `buildHeaderPresenceSelects`. */
	hasCSP: number;
	/** `header_flags.has_x_frame_options`, same coalescing as {@link PagesSourceRow.hasCSP}. */
	hasXFrameOptions: number;
	/** `header_flags.has_x_content_type_options`, same coalescing as {@link PagesSourceRow.hasCSP}. */
	hasXContentTypeOptions: number;
	/** `header_flags.has_hsts`, same coalescing as {@link PagesSourceRow.hasCSP}. */
	hasHSTS: number;
	/**
	 * `content_items.dedupe_cap_event_id`, or `null` when the page's URL
	 * shape was never captured by `--dedupe-cap`. Only the presence/absence
	 * is copied into `viewer_pages` (see {@link ViewerPageInsertRow.is_dedupe_capped});
	 * the event detail itself is resolved live by `getPageDetail`.
	 */
	dedupeCapEventId: number | null;
}

/** One row to insert into `viewer_pages`, derived from a {@link PagesSourceRow}. */
interface ViewerPageInsertRow {
	/** Copied from `PagesSourceRow.id`. */
	page_id: number;
	/** Copied from `PagesSourceRow.url`. */
	url: string;
	/** Copied from `PagesSourceRow.title`. */
	title: string | null;
	/** Copied from `PagesSourceRow.status`. */
	status: number | null;
	/**
	 * Ascending sort key for `sort=status:asc` — `status`, or
	 * {@link NULL_STATUS_SENTINEL} when `status` is `null`. Never `null`
	 * itself (see {@link NULL_STATUS_SENTINEL}'s docs for why).
	 */
	status_sort_key: number;
	/**
	 * Ascending sort key for `sort=status:desc` — the negation of
	 * `status_sort_key` (the normalized-descending-key pattern, e.g.
	 * `status_desc_key = -status`, that keeps keyset ordering stable).
	 * Walking this column ascending yields status descending while keeping
	 * the tie-breaker columns (`url_sort_key`, `page_id`) in a uniform
	 * ascending tuple comparison for keyset cursoring.
	 */
	status_desc_key: number;
	/** `classifyContentType(PagesSourceRow.contentType)`. */
	content_category: string;
	/** Normalised `0`/`1` form of `PagesSourceRow.isExternal`. */
	is_external: number;
	/** `1` iff `title` is non-null and non-empty. */
	has_title: number;
	/** `1` iff `description` is non-null and non-empty. */
	has_description: number;
	/** `1` iff `og_title` is non-null and non-empty. */
	has_og_title: number;
	/** Normalised `0`/`1` form of `PagesSourceRow.robots_noindex`. */
	robots_noindex: number;
	/** Copied from `PagesSourceRow.source` — see {@link PageSource}. */
	source: PageSource;
	/** `PagesSourceRow.tag_count`, defaulted to `0` when `null`. */
	tag_count: number;
	/** `PagesSourceRow.jsonld_count`, defaulted to `0` when `null`. */
	jsonld_count: number;
	/** `PagesSourceRow.main_content_word_count`, defaulted to `0` when `null` — sort/filter only, display re-fetches the true nullable value from `page_meta`. */
	main_content_word_count: number;
	/** `PagesSourceRow.main_content_body_word_count`, defaulted to `0` when `null`. */
	main_content_body_word_count: number;
	/** `PagesSourceRow.main_content_heading_count`, defaulted to `0` when `null`. */
	main_content_heading_count: number;
	/** `PagesSourceRow.main_content_image_count`, defaulted to `0` when `null`. */
	main_content_image_count: number;
	/** `PagesSourceRow.main_content_table_count`, defaulted to `0` when `null`. */
	main_content_table_count: number;
	/** `PagesSourceRow.main_content_button_count`, defaulted to `0` when `null`. */
	main_content_button_count: number;
	/** `PagesSourceRow.main_content_iframe_count`, defaulted to `0` when `null`. */
	main_content_iframe_count: number;
	/** `PagesSourceRow.main_content_video_count`, defaulted to `0` when `null`. */
	main_content_video_count: number;
	/** `PagesSourceRow.main_content_audio_count`, defaulted to `0` when `null`. */
	main_content_audio_count: number;
	/** `PagesSourceRow.main_content_canvas_count`, defaulted to `0` when `null`. */
	main_content_canvas_count: number;
	/** `PagesSourceRow.main_content_custom_element_count`, defaulted to `0` when `null`. */
	main_content_custom_element_count: number;
	/** `PagesSourceRow.scroll_height_desktop`, defaulted to `0` when `null`. */
	scroll_height_desktop: number;
	/** `PagesSourceRow.scroll_height_mobile`, defaulted to `0` when `null`. */
	scroll_height_mobile: number;
	/** `PagesSourceRow.console_error_count`, defaulted to `0` when `null`. */
	console_error_count: number;
	/** Copied from `PagesSourceRow.lang` verbatim (nullable) — filter-only, see the DDL comment. */
	lang: string | null;
	/** Copied from `PagesSourceRow.hasCSP` — filter-only, see the DDL comment. */
	has_csp: number;
	/** Copied from `PagesSourceRow.hasXFrameOptions`. */
	has_x_frame_options: number;
	/** Copied from `PagesSourceRow.hasXContentTypeOptions`. */
	has_x_content_type_options: number;
	/** Copied from `PagesSourceRow.hasHSTS`. */
	has_hsts: number;
	/** `1` iff `PagesSourceRow.dedupeCapEventId` is non-null — filter-only, see the DDL comment. */
	is_dedupe_capped: number;
	/** Copied from `PagesSourceRow.dedupeCapEventId` verbatim — see the DDL comment. */
	dedupe_cap_event_id: number | null;
	/**
	 * Case-preserving sort key for URL ordering — currently just `url`
	 * verbatim, matching `listPages`'s plain `ORDER BY url` (SQLite's
	 * default `BINARY` collation is case-sensitive; lower-casing here would
	 * be a behavior change, left to whichever issue actually wires up
	 * `/api/pages` sorting).
	 */
	url_sort_key: string;
	/**
	 * Case-preserving sort key for title ordering — `title`, or `''` when
	 * `title` is `null`. Never `null` itself, for the same keyset-cursor
	 * reason as {@link NULL_STATUS_SENTINEL}: SQL's three-valued `NULL`
	 * comparison logic would silently break tuple comparisons against a
	 * nullable sort-key column. `''` sorts before any non-empty title in
	 * ascending order, matching the order produced by sorting directly on
	 * the nullable `title` column (SQLite treats `NULL` as smaller than any
	 * value).
	 */
	title_sort_key: string;
	/**
	 * The URL's path component, for directory-prefix range scans (so a
	 * future `/api/pages` directory filter can seek an index range instead
	 * of running LIKE). Stored ahead of use: intentionally has no index and
	 * no reader yet — like `viewer_page_anchors`, wiring the actual
	 * directory-filter query/index belongs to whichever issue implements
	 * `/api/pages`'s directory filter.
	 */
	path_sort_key: string;
	/**
	 * Dense, zero-based rank in natural URL order (see
	 * {@link buildPageNaturalUrlRankMap}) — what `viewer_pages`'s default
	 * `sortBy: 'url'` listing orders by, persisted here so the viewer never
	 * needs to run the startup external merge sort just to serve that order.
	 */
	natural_url_rank: number;
}

/**
 * Derives the path-only sort key used for directory-prefix filtering.
 * Falls back to the full URL string when it cannot be parsed as a URL
 * (defensive only — every URL in `pages` was already parsed once during
 * crawling, so this branch should not be reachable in practice).
 * @param url - The page's absolute URL.
 * @returns The URL's pathname, or `url` itself if unparseable.
 */
function derivePathSortKey(url: string): string {
	try {
		return new URL(url).pathname;
	} catch {
		return url;
	}
}

/**
 * Maps one `pages` row to its `viewer_pages` insert row.
 * @param row - The source row read from `pages`.
 * @param naturalUrlRankByPageId - Rank map from {@link buildPageNaturalUrlRankMap},
 *   computed once across every `sourceRows` entry.
 * @returns The corresponding `viewer_pages` insert row.
 */
function toViewerPageInsertRow(
	row: PagesSourceRow,
	naturalUrlRankByPageId: ReadonlyMap<number, number>,
): ViewerPageInsertRow {
	const statusSortKey = row.status ?? NULL_STATUS_SENTINEL;
	return {
		page_id: row.id,
		url: row.url,
		title: row.title,
		status: row.status,
		status_sort_key: statusSortKey,
		status_desc_key: -statusSortKey,
		content_category: classifyContentType(row.contentType),
		is_external: row.isExternal ? 1 : 0,
		has_title: row.title != null && row.title !== '' ? 1 : 0,
		has_description: row.description != null && row.description !== '' ? 1 : 0,
		has_og_title: row.og_title != null && row.og_title !== '' ? 1 : 0,
		robots_noindex: row.robots_noindex ? 1 : 0,
		source: row.source,
		tag_count: row.tag_count ?? 0,
		jsonld_count: row.jsonld_count ?? 0,
		main_content_word_count: row.main_content_word_count ?? 0,
		main_content_body_word_count: row.main_content_body_word_count ?? 0,
		main_content_heading_count: row.main_content_heading_count ?? 0,
		main_content_image_count: row.main_content_image_count ?? 0,
		main_content_table_count: row.main_content_table_count ?? 0,
		main_content_button_count: row.main_content_button_count ?? 0,
		main_content_iframe_count: row.main_content_iframe_count ?? 0,
		main_content_video_count: row.main_content_video_count ?? 0,
		main_content_audio_count: row.main_content_audio_count ?? 0,
		main_content_canvas_count: row.main_content_canvas_count ?? 0,
		main_content_custom_element_count: row.main_content_custom_element_count ?? 0,
		scroll_height_desktop: row.scroll_height_desktop ?? 0,
		scroll_height_mobile: row.scroll_height_mobile ?? 0,
		console_error_count: row.console_error_count ?? 0,
		lang: row.lang,
		has_csp: row.hasCSP,
		has_x_frame_options: row.hasXFrameOptions,
		has_x_content_type_options: row.hasXContentTypeOptions,
		has_hsts: row.hasHSTS,
		is_dedupe_capped: row.dedupeCapEventId == null ? 0 : 1,
		dedupe_cap_event_id: row.dedupeCapEventId,
		url_sort_key: row.url,
		title_sort_key: row.title ?? '',
		path_sort_key: derivePathSortKey(row.url),
		// Non-null assertion is safe: naturalUrlRankByPageId is built from
		// this exact sourceRows set, so every row.id has an entry.
		natural_url_rank: naturalUrlRankByPageId.get(row.id)!,
	};
}

/**
 * Performs a full rebuild of the viewer read model: backfills
 * `page_meta.body_hash` for any page whose stored HTML predates that column
 * (see `backfillBodyHashFromHtmlBlobs` — a write-model catch-up, not part of
 * the read model itself, run here for the same reason as
 * `backfillAnalysisViolationsFromJson` below). This alone does NOT guarantee
 * every pre-existing archive gets backfilled: `ensureViewerReadModel`'s
 * schema-version gate skips calling this function entirely once an
 * archive's read model is already current, and `body_hash` did not change
 * that schema. `cli/src/commands/viewer-build.ts` therefore also calls
 * `backfillBodyHashFromHtmlBlobs` directly, unconditionally, after either
 * branch of its own `--force` check — the row-count guard inside
 * `backfillBodyHashFromHtmlBlobs` makes that second call a cheap no-op on
 * the `--force` path, where this function already ran it once. Runs
 * `backfillAliasOfId` immediately after — a full recompute (not a
 * backfill-only fill) of `content_items.alias_of_id`, grouping pages that
 * are the same underlying resource under URL-normalization or a
 * body-hash-confirmed trailing-slash variance; it must run after
 * `backfillBodyHashFromHtmlBlobs` since its trailing-slash tier depends on
 * `body_hash` already being computed, and `viewer-build.ts` calls it
 * unconditionally too for the same schema-version-gate reason as
 * `backfillBodyHashFromHtmlBlobs`. Computes a
 * `getSummary` snapshot (see below for why this happens outside the
 * transaction), then drops all 26 tables if present, recreates them,
 * populates `viewer_pages`
 * from the current `pages` write-model table, populates
 * `viewer_directory_nodes`/`viewer_directory_pages` from that same page set
 * (see `buildDirectoryTreeRows` for the tree-building rules), populates
 * `viewer_anchor_facts` from a single `anchors` aggregation query (see
 * `computeAnchorFactRows` — unlike the directory tree, this cannot reuse
 * `sourceRows`, since link data lives on `anchors`, not `pages`) and derives
 * `viewer_external_links` from those same in-memory rows with no second
 * `anchors` scan (see `deriveExternalLinkSummaryRows`), populates
 * `viewer_resources`/`viewer_resource_stats` from a single
 * `resources`/`resources-referrers` aggregation query (see
 * `computeResourceInsertRows` — issue #110, independent of `pages`/`anchors`
 * so its position in this function has no ordering constraint), populates
 * `viewer_images` from a chunked `images` scan annotated with a page-order
 * rank derived from `sourceRows` (see `computeImageInsertRows`/
 * `buildPageUrlRankMap` — issue #113, must run after `sourceRows` is loaded
 * but is otherwise independent of the anchor/resource population above),
 * populates `viewer_header_checks` from its own filtered `pages` query (see
 * `computeHeaderCheckInsertRows` — issue #119, independent of every table
 * above), populates `viewer_duplicate_groups`/`viewer_duplicate_group_pages`
 * (issue #115) via `computeDuplicateGroupRows` (a `title`/`description`
 * `GROUP BY ... HAVING COUNT(*) > 1` aggregation that also assigns each
 * group's `group_id`) followed by `computeDuplicateGroupPageRows` (a second,
 * chunked `pages` scan that matches every member page back to the group(s)
 * it belongs to via the `group_id` lookup the first step returned — a page
 * duplicated on both fields is attached to both groups), populates
 * `viewer_mismatches` (issue #115) from `computeMismatchInsertRows`'s own
 * chunked, per-type `pages` scan (independent of every table above), seeds
 * one
 * smoke-test row into `viewer_query_profiles`, writes the
 * `viewer_count_buckets` totals row plus one row per distinct Pages-list
 * facet value (see `computePageFacetBuckets`), writes the pre-computed
 * `viewer_summary` row from the `getSummary` snapshot taken before the
 * transaction began, writes the two `viewer_error_kind_*` tables (issue
 * #118) from an unfiltered `getErrorKinds` snapshot taken the same way (see
 * `computeErrorKindInsertRows`), and writes the `viewer_read_model_meta`
 * row — all inside one transaction, so a mid-build failure leaves the
 * previous read model (or no read model) intact, never a partially-built
 * one.
 *
 * The `getSummary(accessor)`/`getErrorKinds(accessor)` calls run **before**
 * the transaction starts, unlike `viewer_anchor_facts`/`viewer_pages` which
 * read inside it. Those tables reuse `sourceRows`/`anchors` rows to avoid a
 * second scan of the same source — `getSummary`/`getErrorKinds` have no such
 * shared rows to reuse (the latter reads `page_errors`/`crawl_errors`/
 * `error.log`, none of which `viewer_pages`'s `sourceRows` touches), so
 * there is no performance reason to nest either in the transaction.
 * Computing them first also means either failing aborts before
 * `dropViewerReadModelTables` ever runs, leaving the previous read model
 * untouched instead of rolling back a transaction that already dropped
 * tables. This pre-transaction read is only safe because every source
 * `getSummary`/`getErrorKinds` touch — not just `pages`, but also
 * `page_errors` / `crawl_errors` (for the `status=-1` `errorKindBreakdown`
 * and the error-kind breakdown itself) and, as a fallback, `error.log` — is
 * write-once-during-crawl and never touched by a read-model build itself;
 * neither call site (`ensureViewerReadModelQuietly` at crawl completion, or
 * `viewer-build`) ever runs concurrently with an active scraper writing to
 * the same archive.
 *
 * `getSummary` also requires `accessor.getConfig()` to resolve, making that
 * a precondition of this function too. Every archive that went through a
 * real crawl has this guaranteed: `CrawlerOrchestrator` always calls
 * `archive.setConfig(...)` before `crawling()` starts, and both call sites
 * above only ever operate on archives that already finished (or are
 * resuming) a real crawl. `Archive.create`'s `initSchema` does not itself
 * seed a default `info` row, so this function throws on a `.nitpicker` file
 * that was hand-crafted or corrupted before `setConfig` ever ran — an
 * accepted trade-off, not a scenario either call site is expected to hit in
 * practice.
 *
 * `viewer_pages` includes every listable page regardless of content-type
 * category (`scraped = 1 AND redirectDestId IS NULL`, plus excluding
 * `isSkipped` discovery-only placeholder rows — the same predicate
 * `Database.resetFailedPages` and `excludeSkippedPages` guard against, see
 * that helper's docs for the production incident that motivated it).
 * `content_category` is stored as a column precisely so a future
 * `/api/pages` consumer can filter by it; unlike `listPages`'s *default*
 * view (which only shows HTML + not-yet-classified rows), this table is
 * intentionally NOT pre-filtered to that subset — unfiltered totals here
 * can legitimately exceed `listPages(accessor, {}).total` on an archive
 * that also has known non-HTML pages (PDFs, images, etc.).
 *
 * `viewer_page_anchors` is created but left with zero rows: populating it
 * requires real pagination-cursor math tied to a specific page size/page
 * number, which belongs to whichever issue actually wires up `/api/pages`
 * page-number jumps.
 *
 * Always a full rebuild — there is no incremental/diff path.
 * @param accessor - The archive accessor to build against. Must be
 *   writable (`accessor.readOnly === false`) — typically an `Archive`
 *   returned by `Archive.create`/`Archive.open`, not `Archive.connect`/
 *   `Archive.openCached` (always read-only) or a stub-mode accessor.
 * @param options - Build options.
 * @param options.onProgress - Called after each insert chunk completes —
 *   see {@link BuildViewerReadModelOptions.onProgress}. Omit for a silent
 *   build (the default; e.g. tests and small archives).
 * @param options.onPhase - Called once at the start of each named phase —
 *   see {@link BuildViewerReadModelOptions.onPhase}. Omit for a silent build.
 * @throws {Error} When `accessor.readOnly` is `true`.
 * @example
 * // Typically called once, right after a crawl finishes writing `pages`:
 * await buildViewerReadModel(archive);
 */
export async function buildViewerReadModel(
	accessor: ArchiveAccessor,
	options: BuildViewerReadModelOptions = {},
): Promise<void> {
	if (accessor.readOnly) {
		throw new Error(
			'buildViewerReadModel: cannot build the viewer read model on a read-only ' +
				'ArchiveAccessor (stub-mode, or an accessor opened via Archive.connect / ' +
				'Archive.openCached). The read model may only be built against a writable ' +
				'Archive (Archive.create / Archive.open), typically from the crawl-completion step.',
		);
	}

	const { onProgress, onPhase } = options;
	const knex = accessor.getKnex();
	onPhase?.('backfillingAnalysisViolations');
	await backfillAnalysisViolationsFromJson(accessor);
	// Not wired to `onProgress`: that callback's contract is scoped to
	// `viewer_pages` insert-chunk progress (`ViewerReadModelBuildProgress`),
	// a different shape and a different phase of this build — reusing it
	// here would report body-hash backfill counts under a callback that
	// claims to describe `viewer_pages` rows.
	onPhase?.('backfillingBodyHash');
	await backfillBodyHashFromHtmlBlobs(accessor);
	// Runs after body_hash: alias_of_id's Tier B (trailing-slash) grouping
	// requires body_hash to already be computed for both candidate pages, so
	// this backfill would otherwise see stale (still-NULL) body_hash values
	// on an archive going through both catch-ups in the same build.
	onPhase?.('backfillingAliasOfId');
	await backfillAliasOfId(accessor);
	// Independent of the body_hash/alias_of_id catch-ups above — matches
	// URLs against `dedupe_cap_events.shape_key`, no ordering dependency on
	// either. Must still run before `sourceRows` below reads
	// `ci.dedupe_cap_event_id`.
	onPhase?.('backfillingDedupeCapEventId');
	await backfillDedupeCapEventId(accessor);
	onPhase?.('computingSummary');
	const [summary, errorKinds, isolatedComponents] = await Promise.all([
		getSummary(accessor),
		getErrorKinds(accessor),
		computeIsolatedClusters(accessor),
	]);
	await knex.transaction(async (trx) => {
		onPhase?.('buildingPages');
		await dropViewerReadModelTables(trx);
		await createViewerReadModelTables(trx);

		// Sources `viewer_url_refs` from the 0.13 entity tables
		// (`content_items` + `url_refs`) rather than the legacy `pages.url`
		// column. The output shape is unchanged: `url_refs` holds the same
		// URL set the legacy `pages.url` column did, so every distinct page
		// URL appears exactly once via `content_items.url_id -> url_refs.url`.
		await trx.raw(`
			INSERT INTO viewer_url_refs (id, url)
			SELECT row_number() OVER (ORDER BY url) AS id, url
			FROM (
				SELECT DISTINCT ur.url AS url
				FROM content_items AS ci
				JOIN url_refs AS ur ON ur.id = ci.url_id
			)
			ORDER BY url
		`);

		// `sourceRows` reads through the 0.13 entity tables.
		// LEFT JOIN `page_meta` because the 0.13 format populates
		// `page_meta` only for `scraped = 1` pages — the outer predicate
		// already restricts to those, so the LEFT JOIN's null-fill path is
		// defensive (a missing `page_meta` for a scraped row indicates an
		// incomplete legacy migration and legitimately reads back as null
		// metadata). `content_type_refs` join is inner because every
		// scraped/non-scraped `content_items` row has a
		// `content_type_id` — the 0.13 format routes missing content types
		// through the "unknown" ref.
		const sourceRows: PagesSourceRow[] = await trx('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
			.leftJoin('page_meta as pm', 'pm.page_id', 'ci.id')
			.leftJoin('text_refs as title_ref', 'title_ref.id', 'pm.title_text_id')
			.leftJoin(
				'text_refs as description_ref',
				'description_ref.id',
				'pm.description_text_id',
			)
			.leftJoin('text_refs as og_title_ref', 'og_title_ref.id', 'pm.og_title_text_id')
			// LEFT JOIN for the same "no header_set_id" reason as
			// computeHeaderCheckInsertRows — buildHeaderPresenceSelects'
			// coalesce(..., 0) turns the null-fill into flag 0.
			.leftJoin('header_flags as hf', 'hf.header_set_id', 'ci.header_set_id')
			.where('ci.scraped', 1)
			.whereNull('ci.redirect_dest_id')
			.whereNull('ci.alias_of_id')
			.where((qb) => excludeSkippedPages(qb, 'ci.is_skipped'))
			.select(
				'ci.id as id',
				'ur.url as url',
				'title_ref.text as title',
				'ci.status as status',
				'ctr.raw as contentType',
				'ci.is_external as isExternal',
				'description_ref.text as description',
				'og_title_ref.text as og_title',
				'pm.robots_noindex as robots_noindex',
				'ci.source as source',
				'ci.dedupe_cap_event_id as dedupeCapEventId',
				'pm.tag_count as tag_count',
				'pm.jsonld_count as jsonld_count',
				'pm.main_content_word_count as main_content_word_count',
				'pm.main_content_body_word_count as main_content_body_word_count',
				'pm.main_content_heading_count as main_content_heading_count',
				'pm.main_content_image_count as main_content_image_count',
				'pm.main_content_table_count as main_content_table_count',
				'pm.main_content_button_count as main_content_button_count',
				'pm.main_content_iframe_count as main_content_iframe_count',
				'pm.main_content_video_count as main_content_video_count',
				'pm.main_content_audio_count as main_content_audio_count',
				'pm.main_content_canvas_count as main_content_canvas_count',
				'pm.main_content_custom_element_count as main_content_custom_element_count',
				'pm.scroll_height_desktop as scroll_height_desktop',
				'pm.scroll_height_mobile as scroll_height_mobile',
				'pm.console_error_count as console_error_count',
				'pm.lang as lang',
				...buildHeaderPresenceSelects(trx),
			);

		const naturalUrlRankByPageId = buildPageNaturalUrlRankMap(sourceRows);

		// Separate scan (not part of `sourceRows`, which only selects
		// `pages`/`page_meta`) — one row per (page, technology) pair, joined
		// to the page's URL for `buildTechnologyDirectoryStatsRows`'
		// directory bucketing. Feeds `viewer_technology_summary` /
		// `viewer_technology_directory_stats`.
		const technologySourceRows = await trx('page_technologies as pt')
			.join('content_items as tci', 'tci.id', 'pt.pageId')
			.join('url_refs as tur', 'tur.id', 'tci.url_id')
			.select<
				Array<{
					pageId: number;
					url: string;
					technology: string;
					category: string | null;
					confidence: number;
				}>
			>('pt.pageId as pageId', 'tur.url as url', 'pt.technology as technology', 'pt.category as category', 'pt.confidence as confidence');

		const insertRows = sourceRows.map((row) =>
			toViewerPageInsertRow(row, naturalUrlRankByPageId),
		);
		const pageIdByUrl = new Map(sourceRows.map((row) => [row.url, row.id]));
		const totalRows = insertRows.length;
		let insertedRows = 0;

		// Sequential, not `eachSplitted`'s concurrent `Promise.all` — SQLite
		// serializes writes on this single transaction's connection anyway,
		// so concurrency buys no throughput here, only two real costs: all
		// ~800 chunk arrays (400k-row archive) live in memory simultaneously
		// instead of one at a time, and `onProgress` (below) would report
		// `insertedRows` in whichever order chunks happened to resolve
		// rather than monotonically — exactly the "must show real progress"
		// property issue #112 exists to guarantee.
		for (let start = 0; start < insertRows.length; start += INSERT_CHUNK_SIZE) {
			const chunk = insertRows.slice(start, start + INSERT_CHUNK_SIZE);
			await trx('viewer_pages').insert(chunk);
			insertedRows += chunk.length;
			onProgress?.({ insertedRows, totalRows });
		}

		// Reuses `sourceRows` (already loaded above for `viewer_pages`) instead
		// of issuing a second `pages` SELECT — see `buildDirectoryTreeRows`'s
		// docs for the tree-building rules (host eligibility, trailing-slash
		// directory/page boundary, count propagation).
		onPhase?.('buildingDirectoryTree');
		const { nodes: directoryNodes, pages: directoryPages } = buildDirectoryTreeRows(
			sourceRows.map((row) => ({
				id: row.id,
				url: row.url,
				isExternal: row.isExternal,
				contentType: row.contentType,
				status: row.status,
			})),
		);
		for (let start = 0; start < directoryNodes.length; start += INSERT_CHUNK_SIZE) {
			await trx('viewer_directory_nodes').insert(
				directoryNodes.slice(start, start + INSERT_CHUNK_SIZE),
			);
		}
		for (let start = 0; start < directoryPages.length; start += INSERT_CHUNK_SIZE) {
			await trx('viewer_directory_pages').insert(
				directoryPages.slice(start, start + INSERT_CHUNK_SIZE),
			);
		}

		// Reuses `technologySourceRows` (already loaded above) instead of a
		// second `page_technologies` scan.
		onPhase?.('buildingTechnologySummary');
		const technologySummaryRows = buildTechnologySummaryRows(technologySourceRows);
		for (
			let start = 0;
			start < technologySummaryRows.length;
			start += INSERT_CHUNK_SIZE
		) {
			await trx('viewer_technology_summary').insert(
				technologySummaryRows.slice(start, start + INSERT_CHUNK_SIZE),
			);
		}
		const technologyDirectoryStatsRows =
			buildTechnologyDirectoryStatsRows(technologySourceRows);
		for (
			let start = 0;
			start < technologyDirectoryStatsRows.length;
			start += INSERT_CHUNK_SIZE
		) {
			await trx('viewer_technology_directory_stats').insert(
				technologyDirectoryStatsRows.slice(start, start + INSERT_CHUNK_SIZE),
			);
		}

		onPhase?.('buildingIsolatedComponents');
		const isolatedRows = buildIsolatedReadModelRows(isolatedComponents, pageIdByUrl);
		for (
			let start = 0;
			start < isolatedRows.components.length;
			start += INSERT_CHUNK_SIZE
		) {
			await trx('viewer_isolated_components').insert(
				isolatedRows.components.slice(start, start + INSERT_CHUNK_SIZE),
			);
		}
		for (let start = 0; start < isolatedRows.pages.length; start += INSERT_CHUNK_SIZE) {
			await trx('viewer_isolated_component_pages').insert(
				isolatedRows.pages.slice(start, start + INSERT_CHUNK_SIZE),
			);
		}

		// Unlike `viewer_pages`/the directory tree, this needs its own `anchors`
		// query — `sourceRows` (loaded from `pages` only) has no anchor/link
		// data. Runs once, here, instead of on every `/api/links?type=broken`
		// request — see `computeAnchorFactRows`'s docs for the SQLite
		// performance rationale, and for why it yields `source.id`-range
		// chunks rather than every row at once (a large archive's `anchors`
		// table can hold millions of edges — materialising them into one
		// array risks the same OOM class PR #168 fixed for URL sorting).
		// Each chunk's external-link summary is folded into
		// `viewer_external_links` via `upsertExternalLinkRows`'s `ON CONFLICT`
		// upsert, rather than accumulating a running per-destination tally in
		// JS across the whole build — see `deriveExternalLinkSummaryRows`'s
		// docs for why a whole-build JS-side accumulator would defeat the
		// bounded-memory guarantee the chunked read exists to provide.
		onPhase?.('buildingAnchorFacts');
		for await (const anchorFactChunk of computeAnchorFactRows(
			trx,
			undefined,
			(scannedUpToId, maxId) => {
				onProgress?.({ insertedRows: scannedUpToId, totalRows: maxId });
			},
		)) {
			for (let start = 0; start < anchorFactChunk.length; start += INSERT_CHUNK_SIZE) {
				await trx('viewer_anchor_facts').insert(
					anchorFactChunk.slice(start, start + INSERT_CHUNK_SIZE),
				);
			}
			await upsertExternalLinkRows(trx, deriveExternalLinkSummaryRows(anchorFactChunk));
		}

		onPhase?.('buildingGraph');
		const graphIndegreeByPageId = new Map<number, number>();
		for await (const graphEdgeChunk of computeGraphReadModelRows(trx)) {
			for (const edge of graphEdgeChunk) {
				graphIndegreeByPageId.set(
					edge.target_page_id,
					(graphIndegreeByPageId.get(edge.target_page_id) ?? 0) + 1,
				);
			}
			for (let start = 0; start < graphEdgeChunk.length; start += INSERT_CHUNK_SIZE) {
				await trx('viewer_graph_edges').insert(
					graphEdgeChunk.slice(start, start + INSERT_CHUNK_SIZE),
				);
			}
		}

		const graphNodeRows = sourceRows
			.filter((row) => !row.isExternal && row.contentType === 'text/html')
			.map((row) => ({
				page_id: row.id,
				url: row.url,
				status: row.status,
				indegree: graphIndegreeByPageId.get(row.id) ?? 0,
				source: row.source,
			}));
		for (let start = 0; start < graphNodeRows.length; start += INSERT_CHUNK_SIZE) {
			await trx('viewer_graph_nodes').insert(
				graphNodeRows.slice(start, start + INSERT_CHUNK_SIZE),
			);
		}

		// Independent of `pages`/`anchors` — reads `resources` +
		// `resources-referrers` in bounded chunks (see
		// `computeResourceInsertRows`'s docs for the "one scan, two tables"
		// pattern and its chunking rationale, the same technique as
		// `viewer_anchor_facts`/`viewer_external_links` above).
		onPhase?.('buildingResources');
		for await (const {
			resources: resourceChunk,
			stats: statsChunk,
		} of computeResourceInsertRows(trx)) {
			for (let start = 0; start < resourceChunk.length; start += INSERT_CHUNK_SIZE) {
				await trx('viewer_resources').insert(
					resourceChunk.slice(start, start + INSERT_CHUNK_SIZE),
				);
			}
			for (let start = 0; start < statsChunk.length; start += INSERT_CHUNK_SIZE) {
				await trx('viewer_resource_stats').insert(
					statsChunk.slice(start, start + INSERT_CHUNK_SIZE),
				);
			}
		}

		// Image-list read model (issue #113). `pageUrlRankById` reuses
		// `sourceRows` (already loaded above for `viewer_pages`) rather than a
		// second `pages` query — see `buildPageUrlRankMap`'s docs for why a
		// small integer surrogate, not the page URL text itself, is what
		// `viewer_images` inlines for its page-order sort. `images` is this
		// codebase's single largest write-model table, so — unlike
		// `viewer_pages`'s `sourceRows` — it is read in bounded chunks (see
		// `computeImageInsertRows`'s docs), the same OOM-avoidance pattern as
		// `viewer_anchor_facts`/`viewer_resources` above.
		onPhase?.('buildingImages');
		const pageUrlRankById = buildPageUrlRankMap(sourceRows);
		for await (const imageChunk of computeImageInsertRows(trx, pageUrlRankById)) {
			for (let start = 0; start < imageChunk.length; start += INSERT_CHUNK_SIZE) {
				await trx('viewer_images').insert(
					imageChunk.slice(start, start + INSERT_CHUNK_SIZE),
				);
			}
		}

		// Header-check read model (issue #119). Its own `pages` query, not a
		// reuse of `sourceRows`: `checkHeaders`'s filter predicate
		// (`isExternal = 0 AND contentType = 'text/html'`, no
		// `excludeSkippedPages`) differs from `viewer_pages`'s broader
		// unfiltered set, so a shared row set would still need re-filtering —
		// see `computeHeaderCheckInsertRows`'s docs for why this stays a plain
		// array rather than a chunked read.
		onPhase?.('buildingHeaderChecks');
		const headerCheckRows = await computeHeaderCheckInsertRows(trx);
		for (let start = 0; start < headerCheckRows.length; start += INSERT_CHUNK_SIZE) {
			await trx('viewer_header_checks').insert(
				headerCheckRows.slice(start, start + INSERT_CHUNK_SIZE),
			);
		}

		// Duplicate-metadata group read model (issue #115). `computeDuplicateGroupRows`
		// finds every title/description duplicate group and assigns each a
		// sequential `group_id` (the same `buildDirectoryTreeRows`-style JS id
		// assignment `viewer_directory_nodes.node_id` uses) — required because
		// `viewer_duplicate_group_pages` rows must reference a group's id
		// before either table is inserted. `computeDuplicateGroupPageRows` then
		// re-scans `pages` in id-keyset-bounded chunks, using the returned
		// `groupIdByValue` lookup to attach every member page to its group(s)
		// — a page duplicated on both `title` and `description` is attached to
		// both.
		onPhase?.('buildingDuplicateGroups');
		const { groups: duplicateGroupRows, groupIdByValue } =
			await computeDuplicateGroupRows(trx);
		for (let start = 0; start < duplicateGroupRows.length; start += INSERT_CHUNK_SIZE) {
			await trx('viewer_duplicate_groups').insert(
				duplicateGroupRows.slice(start, start + INSERT_CHUNK_SIZE),
			);
		}
		for await (const duplicateGroupPageChunk of computeDuplicateGroupPageRows(
			trx,
			groupIdByValue,
		)) {
			for (
				let start = 0;
				start < duplicateGroupPageChunk.length;
				start += INSERT_CHUNK_SIZE
			) {
				await trx('viewer_duplicate_group_pages').insert(
					duplicateGroupPageChunk.slice(start, start + INSERT_CHUNK_SIZE),
				);
			}
		}

		// Metadata-mismatch read model (issue #115). `computeMismatchInsertRows`
		// scans `pages` once per mismatch type (`canonical`, `og:title`,
		// `og:description`) in id-keyset-bounded chunks, applying the exact
		// WHERE predicate `findMismatches` itself uses per type.
		// `mismatch_id` is left to SQLite's own `AUTOINCREMENT` (the same
		// `viewer_anchor_facts.edge_id` convention) — unlike
		// `viewer_duplicate_groups.group_id` above, nothing else references a
		// mismatch row by id before it is inserted.
		onPhase?.('buildingMismatches');
		for await (const mismatchChunk of computeMismatchInsertRows(trx)) {
			for (let start = 0; start < mismatchChunk.length; start += INSERT_CHUNK_SIZE) {
				await trx('viewer_mismatches').insert(
					mismatchChunk.slice(start, start + INSERT_CHUNK_SIZE),
				);
			}
		}

		const total = insertRows.length;
		await trx('viewer_query_profiles').insert({
			scope: 'pages',
			profile_key: 'default',
			sort_key: 'url_sort_key',
			sort_order: 'asc',
			total,
		});
		await trx('viewer_count_buckets').insert({
			scope: 'pages',
			key: 'total',
			value: 'all',
			count: total,
		});
		const facetBuckets = computePageFacetBuckets(sourceRows);
		for (let start = 0; start < facetBuckets.length; start += INSERT_CHUNK_SIZE) {
			await trx('viewer_count_buckets').insert(
				facetBuckets.slice(start, start + INSERT_CHUNK_SIZE),
			);
		}

		await trx('viewer_summary').insert({
			id: 1,
			total_pages: summary.totalPages,
			internal_pages: summary.internalPages,
			external_pages: summary.externalPages,
			internal_contents: summary.internalContents,
			external_contents: summary.externalContents,
			status_json: JSON.stringify(summary.statusDistribution),
			content_type_json: JSON.stringify(summary.contentTypeDistribution),
			technology_json: JSON.stringify(summary.technologyDistribution),
			metadata_json: JSON.stringify(summary.metadataFulfillment),
			network_outage_affected_failures: summary.networkOutageAffectedFailures,
			console_json: JSON.stringify(summary.consoleLogCounts),
		});

		// Normalises the `getErrorKinds` snapshot taken before this
		// transaction started (see this function's docs) into the
		// `viewer_error_kind_*` tables — no second classification pass.
		// Chunked like every other bulk insert above: a real crawl can fail
		// against many thousands of distinct hosts, so inserting every entry
		// as a single `.insert()` call could exceed the driver's
		// bound-parameter ceiling and fail the whole build.
		const errorKindRows = computeErrorKindInsertRows(errorKinds);
		for (
			let start = 0;
			start < errorKindRows.entries.length;
			start += INSERT_CHUNK_SIZE
		) {
			await trx('viewer_error_kind_entries').insert(
				errorKindRows.entries.slice(start, start + INSERT_CHUNK_SIZE),
			);
		}
		await trx('viewer_error_kind_meta').insert({ id: 1, ...errorKindRows.meta });

		// Every table above is now fully populated — build every index in one
		// pass instead of maintaining them incrementally during the inserts
		// above. See `createViewerReadModelIndexes`'s docs for the measured
		// cost of doing this the other way around (on an 11 GB archive,
		// maintaining indexes during the inserts puts the `viewer_anchor_facts`
		// load at 29+ minutes, vs. well under 2 minutes with post-load
		// indexing).
		onPhase?.('creatingIndexes');
		await createViewerReadModelIndexes(trx, (completed, totalIndexes) => {
			onProgress?.({ insertedRows: completed, totalRows: totalIndexes });
		});

		await trx('viewer_read_model_meta').insert({
			id: 1,
			schema_version: VIEWER_READ_MODEL_SCHEMA_VERSION,
			built_at: Date.now(),
			source_row_count: total,
		});
	});
}
