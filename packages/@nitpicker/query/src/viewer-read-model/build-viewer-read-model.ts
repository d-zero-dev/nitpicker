import type { BuildViewerReadModelOptions, PageSource } from '../types.js';
import type { ExURL } from '@d-zero/shared/parse-url';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { decodeURISafely } from '@d-zero/shared/decode-uri-safely';
import { tryParseUrl } from '@d-zero/shared/parse-url';

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
import { computeDirIndexInboundLinkCountByPageId } from './compute-dir-index-inbound-link-count-by-page-id.js';
import { computeDisplayTitleByPageId } from './compute-display-title-by-page-id.js';
import { computeDuplicateGroupPageRows } from './compute-duplicate-group-page-rows.js';
import { computeDuplicateGroupRows } from './compute-duplicate-group-rows.js';
import { computeErrorKindInsertRows } from './compute-error-kind-insert-rows.js';
import { computeGraphReadModelRows } from './compute-graph-read-model-rows.js';
import { computeHeaderCheckInsertRows } from './compute-header-check-insert-rows.js';
import { computeImageInsertRows } from './compute-image-insert-rows.js';
import { computeMismatchInsertRows } from './compute-mismatch-rows.js';
import { computePageFacetBuckets } from './compute-page-facet-buckets.js';
import { computeResourceGroupRows } from './compute-resource-group-rows.js';
import { computeResourceInsertRows } from './compute-resource-rows.js';
import { createViewerReadModelIndexes } from './create-viewer-read-model-indexes.js';
import { createViewerReadModelTables } from './create-viewer-read-model-tables.js';
import { deriveExternalLinkSummaryRows } from './derive-external-link-summary-rows.js';
import { dropViewerReadModelTables } from './drop-viewer-read-model-tables.js';
import { NULL_STATUS_SENTINEL } from './null-status-sentinel.js';
import { upsertExternalLinkRows } from './upsert-external-link-rows.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model-schema-version.js';

/** Number of rows written per `INSERT` statement for every `viewer_*` table this file populates. */
const INSERT_CHUNK_SIZE = 500;

/** Named parameters for {@link insertChunked}. */
interface InsertChunkedOptions<T extends object> {
	/** The open transaction to insert through. */
	readonly trx: Knex;
	/** Destination table name. */
	readonly table: string;
	/** Rows to insert, in order. A no-op for an empty array (the loop body never runs). */
	readonly rows: readonly T[];
	/**
	 * Called after each chunk's `INSERT` resolves, with that chunk's own row
	 * count — not a running total, since some callers accumulate one shared
	 * counter/`onProgress` call across several tables (e.g.
	 * `viewer_directory_nodes` + `viewer_directory_pages`).
	 */
	readonly onChunkInserted?: (chunkLength: number) => void;
}

/**
 * Inserts `rows` into `table`, `INSERT_CHUNK_SIZE` rows per `INSERT`
 * statement — SQLite's bound-parameter ceiling means a single `.insert()`
 * call across an entire read-model-sized array can fail outright on a
 * large archive. Every bulk insert in `buildViewerReadModel` goes through
 * this one helper instead of repeating the slice-and-insert loop, so a
 * future change to the chunking strategy (a different chunk size,
 * retry-on-lock, etc.) only has to happen in one place.
 * @param options - See {@link InsertChunkedOptions}.
 * @param options.trx - The open transaction to insert through.
 * @param options.table - Destination table name.
 * @param options.rows - Rows to insert, in order. A no-op for an empty
 *   array (the loop body never runs).
 * @param options.onChunkInserted - Called after each chunk's `INSERT`
 *   resolves, with that chunk's own row count — see
 *   {@link InsertChunkedOptions.onChunkInserted}.
 * @example
 * let insertedRows = 0;
 * await insertChunked({
 *   trx,
 *   table: 'viewer_pages',
 *   rows: insertRows,
 *   onChunkInserted: (n) => {
 *     insertedRows += n;
 *     onProgress?.({ insertedRows, totalRows: insertRows.length });
 *   },
 * });
 */
async function insertChunked<T extends object>({
	trx,
	table,
	rows,
	onChunkInserted,
}: InsertChunkedOptions<T>): Promise<void> {
	for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
		const chunk = rows.slice(start, start + INSERT_CHUNK_SIZE);
		await trx(table).insert(chunk);
		onChunkInserted?.(chunk.length);
	}
}

/**
 * Rows read per keyset chunk while loading the `viewer_pages` source rows
 * and the technology source rows (issue #294). The full row sets are still
 * accumulated in memory exactly as the previous single-SELECT read did —
 * chunking exists purely so the multi-minute scan can report progress, not
 * to bound memory.
 */
const SOURCE_READ_CHUNK_SIZE = 2000;

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
	/** From `computeDisplayTitleByPageId` — see the DDL comment for why this has no write-model source. */
	display_title: string | null;
	/** From the `viewer_anchor_facts` build's in-memory tally, defaulted to `0` when the page received no internal links — see the DDL comment. */
	inbound_link_count: number;
	/** From `computeDirIndexInboundLinkCountByPageId` — `null` for non-index pages, see that function's docs. */
	dir_index_inbound_link_count: number | null;
	/** From {@link deriveUrlDecomposition} — `null` when `url` fails to parse. */
	protocol: string | null;
	/** From {@link deriveUrlDecomposition} — `null` when `url` fails to parse. */
	hostname: string | null;
	/** From {@link deriveUrlDecomposition} — `null` when `url` fails to parse or has no segment at this depth. */
	path1: string | null;
	/** See {@link path1}. */
	path2: string | null;
	/** See {@link path1}. */
	path3: string | null;
	/** See {@link path1}. */
	path4: string | null;
	/** See {@link path1}. */
	path5: string | null;
	/** See {@link path1}. */
	path6: string | null;
	/** See {@link path1}. */
	path7: string | null;
	/** See {@link path1}. */
	path8: string | null;
	/** See {@link path1}. */
	path9: string | null;
	/** See {@link path1}. */
	path10: string | null;
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
 * Falls back to the full URL string when `parsed` is `null` (defensive
 * only — every URL in `pages` was already parsed once during crawling, so
 * this branch should not be reachable in practice). Takes the already-parsed
 * result (shared with {@link deriveUrlDecomposition}) rather than
 * re-parsing `url` itself, since both derive from the same source string.
 * @param url - The page's absolute URL.
 * @param parsed - `tryParseUrl(url)`'s result, or `null` if unparseable.
 * @returns The URL's pathname, or `url` itself if unparseable.
 */
function derivePathSortKey(url: string, parsed: ExURL | null): string {
	return parsed?.pathname ?? url;
}

/** The `protocol`/`hostname`/`path1`..`path10` slice of a {@link ViewerPageInsertRow}. */
type UrlDecomposition = Pick<
	ViewerPageInsertRow,
	| 'protocol'
	| 'hostname'
	| 'path1'
	| 'path2'
	| 'path3'
	| 'path4'
	| 'path5'
	| 'path6'
	| 'path7'
	| 'path8'
	| 'path9'
	| 'path10'
>;

const EMPTY_URL_DECOMPOSITION: UrlDecomposition = {
	protocol: null,
	hostname: null,
	path1: null,
	path2: null,
	path3: null,
	path4: null,
	path5: null,
	path6: null,
	path7: null,
	path8: null,
	path9: null,
	path10: null,
};

/**
 * Splits a page's URL into `protocol`/`hostname`/up-to-10 path segments, for
 * the Page List report sheet's Protocol/Domain/path1..path10 columns (see
 * the `viewer_pages` DDL comment for why these are precomputed here instead
 * of report-google-sheets re-parsing `url` on every `report` run). The
 * segment that lands in `path10` (the true last segment when there are 10
 * or fewer, otherwise the 10th) carries the query string appended, matching
 * the legacy per-row computation this replaces — segments past the 10th are
 * dropped, the same as any URL deeper than the sheet's fixed column count,
 * but the query string is never lost along with them. Returns all-`null`
 * when `parsed` is `null` (defensive only — every URL in `pages` was
 * already parsed once during crawling). Takes the already-parsed result
 * (shared with {@link derivePathSortKey}) rather than re-parsing `url`
 * itself, since both derive from the same source string.
 * @param parsed - `tryParseUrl(url)`'s result, or `null` if unparseable.
 */
function deriveUrlDecomposition(parsed: ExURL | null): UrlDecomposition {
	if (!parsed) {
		return EMPTY_URL_DECOMPOSITION;
	}
	// Truncate to the 10 segments this decomposition can actually carry
	// *before* appending the query string — appending to the true last
	// segment first (as the destructuring below only ever reads indices
	// 0..9) would silently drop both the query string and the segment it
	// was attached to whenever the URL has more than 10 segments, instead
	// of surfacing them on `path10`.
	const paths = parsed.paths.slice(0, 10);
	if (paths.length > 0 && parsed.query) {
		paths[paths.length - 1] = `${paths.at(-1)}?${parsed.query}`;
	}
	const [path1, path2, path3, path4, path5, path6, path7, path8, path9, path10] =
		paths.map((p) => `/${decodeURISafely(p)}`);
	return {
		protocol: parsed.protocol,
		hostname: parsed.hostname,
		path1: path1 || null,
		path2: path2 || null,
		path3: path3 || null,
		path4: path4 || null,
		path5: path5 || null,
		path6: path6 || null,
		path7: path7 || null,
		path8: path8 || null,
		path9: path9 || null,
		path10: path10 || null,
	};
}

/**
 * Maps one `pages` row to its `viewer_pages` insert row.
 * @param row - The source row read from `pages`.
 * @param naturalUrlRankByPageId - Rank map from {@link buildPageNaturalUrlRankMap},
 *   computed once across every `sourceRows` entry.
 * @param displayTitleByPageId - From {@link computeDisplayTitleByPageId}.
 * @param inboundLinkCountByPageId - The `viewer_anchor_facts` build's
 *   in-memory per-destination tally.
 * @param dirIndexInboundLinkCountByPageId - From
 *   {@link computeDirIndexInboundLinkCountByPageId}.
 * @returns The corresponding `viewer_pages` insert row.
 */
function toViewerPageInsertRow(
	row: PagesSourceRow,
	naturalUrlRankByPageId: ReadonlyMap<number, number>,
	displayTitleByPageId: ReadonlyMap<number, string | null>,
	inboundLinkCountByPageId: ReadonlyMap<number, number>,
	dirIndexInboundLinkCountByPageId: ReadonlyMap<number, number>,
): ViewerPageInsertRow {
	const statusSortKey = row.status ?? NULL_STATUS_SENTINEL;
	const parsedUrl = tryParseUrl(row.url);
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
		display_title: displayTitleByPageId.get(row.id) ?? null,
		inbound_link_count: inboundLinkCountByPageId.get(row.id) ?? 0,
		dir_index_inbound_link_count: dirIndexInboundLinkCountByPageId.get(row.id) ?? null,
		...deriveUrlDecomposition(parsedUrl),
		url_sort_key: row.url,
		title_sort_key: row.title ?? '',
		path_sort_key: derivePathSortKey(row.url, parsedUrl),
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
 * transaction), then drops all 27 tables if present, recreates them,
 * populates `viewer_anchor_facts` from a single `anchors` aggregation query
 * (see `computeAnchorFactRows` — unlike the directory tree, this cannot
 * reuse `sourceRows`, since link data lives on `anchors`, not `pages`),
 * derives `viewer_external_links` from those same in-memory rows with no
 * second `anchors` scan (see `deriveExternalLinkSummaryRows`), and tallies
 * each destination's inbound-link count in memory along the way (issue:
 * report-google-sheets rewrite) — deliberately run **before** `viewer_pages`
 * (see the "moved ahead of `buildingPages`" comment at its call site) so
 * `viewer_pages.inbound_link_count`/`dir_index_inbound_link_count` (from
 * `computeDisplayTitleByPageId`/`computeDirIndexInboundLinkCountByPageId`)
 * can be written in the same insert pass as every other `viewer_pages`
 * column, rather than a second UPDATE sweep after the fact. Populates
 * `viewer_pages` from the current `pages` write-model table, populates
 * `viewer_directory_nodes`/`viewer_directory_pages` from that same page set
 * (see `buildDirectoryTreeRows` for the tree-building rules), populates
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
				'ArchiveAccessor (stub-mode, or a read-only accessor opened via Archive.connect / ' +
				'Archive.openCached). The read model may only be built against a writable ' +
				'connection (Archive.create / Archive.open, or the writable Archive.connect ' +
				'the viewer-read-model worker thread opens), typically from the crawl-completion step.',
		);
	}

	const { onProgress, onPhase } = options;
	const knex = accessor.getKnex();
	// Adapts the backfills' own `(processed, total)` callback shape to this
	// build's phase-generic `onProgress` (issue #294) — the current phase
	// (tracked by the caller via `onPhase`) tells the display which backfill
	// the counts belong to.
	const relayBackfillProgress = (processed: number, total: number) => {
		onProgress?.({ insertedRows: processed, totalRows: total });
	};
	onPhase?.('backfillingAnalysisViolations');
	// Not wired to `onProgress`: a single all-or-nothing `replaceAnalysisViolations`
	// call with no countable unit, and a fast no-op on any archive already
	// backfilled once — unlike the three per-page backfills below.
	await backfillAnalysisViolationsFromJson(accessor);
	onPhase?.('backfillingBodyHash');
	await backfillBodyHashFromHtmlBlobs(accessor, relayBackfillProgress);
	// Runs after body_hash: alias_of_id's Tier B (trailing-slash) grouping
	// requires body_hash to already be computed for both candidate pages, so
	// this backfill would otherwise see stale (still-NULL) body_hash values
	// on an archive going through both catch-ups in the same build.
	onPhase?.('backfillingAliasOfId');
	await backfillAliasOfId(accessor, relayBackfillProgress);
	// Independent of the body_hash/alias_of_id catch-ups above — matches
	// URLs against `dedupe_cap_events.shape_key`, no ordering dependency on
	// either. Must still run before `sourceRows` below reads
	// `ci.dedupe_cap_event_id`.
	onPhase?.('backfillingDedupeCapEventId');
	await backfillDedupeCapEventId(accessor, relayBackfillProgress);
	onPhase?.('computingSummary');
	// Progress unit = completed computations out of 3. The three run under
	// one `Promise.all` but SQLite serializes them on this single connection
	// anyway, so completion order is stable enough for a monotonic count —
	// and each one is a multi-minute full-table aggregation on a large
	// archive (issue #294), so even a coarse 1/3 → 3/3 beats silence.
	let completedSummarySteps = 0;
	const trackSummaryStep = async <T>(step: Promise<T>): Promise<T> => {
		const result = await step;
		completedSummarySteps += 1;
		onProgress?.({ insertedRows: completedSummarySteps, totalRows: 3 });
		return result;
	};
	const [summary, errorKinds, isolatedComponents] = await Promise.all([
		trackSummaryStep(getSummary(accessor)),
		trackSummaryStep(getErrorKinds(accessor)),
		trackSummaryStep(computeIsolatedClusters(accessor)),
	]);
	await knex.transaction(async (trx) => {
		// Split from `buildingPages` (issue #294): the table drop/create and
		// the `viewer_url_refs` INSERT below are single statements with no
		// countable unit, and the source-row scan that follows counts scanned
		// ids, not inserted rows. Giving the stretch its own phase label keeps
		// `buildingPages` reserved for the insert loop that actually counts
		// `viewer_pages` rows, instead of looking like a stalled insert.
		onPhase?.('loadingPageRows');
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

		// Progress axis for the two keyset scans below (source rows and
		// technology rows) — both cursor over `content_items.id`. MAX() over
		// the keyset column is an O(1) index-tail read.
		const [maxContentItemRow] = await trx('content_items').max<{ max: number | null }[]>({
			max: 'id',
		});
		const maxContentItemId = maxContentItemRow?.max ?? 0;

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
		//
		// `ci.is_target = 1 OR ci.is_external = 1` excludes title-only
		// internal scrapes (the crawler's `metadataOnly` mode — see
		// `crawler.ts`'s `isMetadataOnly`/`isTarget: false` writes) while
		// still keeping external pages, which are always written with
		// `is_target = 0` regardless of mode (`link-to-page-data.ts`/
		// `resource-to-page-data.ts`/`fetch-destination.ts` all set
		// `isTarget: !isExternal`) — `is_target` alone cannot distinguish
		// "external" from "internal but title-only", so both columns are
		// needed together. A title-only internal row is `scraped = 1` and
		// not `is_skipped`/redirect/alias, so without this predicate it
		// would otherwise pass every other filter here and surface as a
		// full page row even though only a title was ever fetched for it.
		// The legacy pre-rewrite report applied the equivalent
		// `!page.isInternalPage() || !page.isTarget` exclusion per row
		// (kept iff internal-and-target, or external); this reinstates
		// that once, at the shared source, so every `sourceRows`-derived
		// table (not just Page List) is consistent.
		//
		// Read in id-keyset chunks (issue #294): the previous single SELECT
		// held the build silent for minutes on a large archive with no way to
		// report progress mid-statement. The chunks accumulate into the same
		// full array the single SELECT produced (memory profile unchanged —
		// see SOURCE_READ_CHUNK_SIZE's docs); only the scan becomes
		// observable.
		const sourceRows: PagesSourceRow[] = [];
		let lastSourceId = 0;
		for (;;) {
			const chunk: PagesSourceRow[] = await trx('content_items as ci')
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
				.where((qb) => qb.where('ci.is_target', 1).orWhere('ci.is_external', 1))
				.whereNull('ci.redirect_dest_id')
				.whereNull('ci.alias_of_id')
				.where((qb) => excludeSkippedPages(qb, 'ci.is_skipped'))
				.andWhere('ci.id', '>', lastSourceId)
				.orderBy('ci.id', 'asc')
				.limit(SOURCE_READ_CHUNK_SIZE)
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
			if (chunk.length === 0) {
				onProgress?.({ insertedRows: maxContentItemId, totalRows: maxContentItemId });
				break;
			}
			lastSourceId = chunk.at(-1)!.id;
			// Avoid `push(...chunk)`: the same V8 argument-spread limit note as
			// compute-isolated-clusters.ts — a habit kept even at this chunk
			// size so the pattern stays copy-safe.
			for (const row of chunk) {
				sourceRows.push(row);
			}
			onProgress?.({
				insertedRows: Math.min(lastSourceId, maxContentItemId),
				totalRows: maxContentItemId,
			});
		}

		const naturalUrlRankByPageId = buildPageNaturalUrlRankMap(sourceRows);
		const pageIdByUrl = new Map(sourceRows.map((row) => [row.url, row.id]));

		// Separate scan (not part of `sourceRows`, which only selects
		// `pages`/`page_meta`) — one row per (page, technology) pair, joined
		// to the page's URL for `buildTechnologyDirectoryStatsRows`'
		// directory bucketing. Feeds `viewer_technology_summary` /
		// `viewer_technology_directory_stats`.
		//
		// Its own phase (issue #294): on a large archive this scan returns
		// millions of rows and runs for minutes. Read in fixed `pt.pageId`
		// ranges (the `compute-anchor-fact-rows.ts` window technique) rather
		// than keyset-LIMIT: a LIMIT cursor on `pageId` could split one
		// page's technology rows across chunks and then skip the remainder.
		onPhase?.('loadingTechnologyRows');
		const technologySourceRows: Array<{
			pageId: number;
			url: string;
			technology: string;
			category: string | null;
			confidence: number;
		}> = [];
		for (
			let rangeEnd = SOURCE_READ_CHUNK_SIZE;
			maxContentItemId > 0;
			rangeEnd += SOURCE_READ_CHUNK_SIZE
		) {
			const chunk = await trx('page_technologies as pt')
				.join('content_items as tci', 'tci.id', 'pt.pageId')
				.join('url_refs as tur', 'tur.id', 'tci.url_id')
				.whereBetween('pt.pageId', [rangeEnd - SOURCE_READ_CHUNK_SIZE + 1, rangeEnd])
				.select<
					Array<{
						pageId: number;
						url: string;
						technology: string;
						category: string | null;
						confidence: number;
					}>
				>(
					'pt.pageId as pageId',
					'tur.url as url',
					'pt.technology as technology',
					'pt.category as category',
					'pt.confidence as confidence',
				);
			for (const row of chunk) {
				technologySourceRows.push(row);
			}
			onProgress?.({
				insertedRows: Math.min(rangeEnd, maxContentItemId),
				totalRows: maxContentItemId,
			});
			if (rangeEnd >= maxContentItemId) {
				break;
			}
		}

		// Moved ahead of `buildingPages` (report-google-sheets rewrite,
		// issue: OOM on large archives): building `viewer_anchor_facts` first
		// lets `viewer_pages.inbound_link_count`/`dir_index_inbound_link_count`
		// (below) be computed once, in memory, and written as part of the same
		// `viewer_pages` insert, instead of a second full-archive query after
		// the fact. `buildingGraph` further down INNER JOINs both this table
		// and `viewer_pages` (see `compute-graph-read-model-rows.ts`), so this
		// reordering must keep both phases ahead of it — moving
		// `buildingAnchorFacts` earlier preserves that constraint as long as
		// `buildingPages` still runs before `buildingGraph`, which it does.
		//
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
		//
		// `inboundLinkCountByPageId` IS a whole-build JS-side accumulator, but
		// a bounded one: one integer per page that receives at least one
		// internal link (at most `sourceRows.length` entries), not one entry
		// per edge or per link occurrence — the same bounded-by-page-count
		// shape as `naturalUrlRankByPageId`/`pageIdByUrl` above.
		onPhase?.('buildingAnchorFacts');
		const inboundLinkCountByPageId = new Map<number, number>();
		for await (const anchorFactChunk of computeAnchorFactRows(
			trx,
			undefined,
			(scannedUpToId, maxId) => {
				onProgress?.({ insertedRows: scannedUpToId, totalRows: maxId });
			},
		)) {
			await insertChunked({ trx, table: 'viewer_anchor_facts', rows: anchorFactChunk });
			await upsertExternalLinkRows(trx, deriveExternalLinkSummaryRows(anchorFactChunk));
			for (const fact of anchorFactChunk) {
				inboundLinkCountByPageId.set(
					fact.dest_page_id,
					(inboundLinkCountByPageId.get(fact.dest_page_id) ?? 0) + 1,
				);
			}
		}

		// Page List report support: computed here, after `viewer_anchor_facts`
		// exists but before the `viewer_pages` insert below, so both land in
		// the same insert pass rather than a second UPDATE sweep. See each
		// function's docs for why this needs a full-archive view
		// `joinViewerPageIdsToListItems`'s per-page-id lookup cannot provide.
		const displayTitleByPageId = computeDisplayTitleByPageId(sourceRows);
		const dirIndexInboundLinkCountByPageId = computeDirIndexInboundLinkCountByPageId(
			sourceRows,
			inboundLinkCountByPageId,
		);
		const insertRows = sourceRows.map((row) =>
			toViewerPageInsertRow(
				row,
				naturalUrlRankByPageId,
				displayTitleByPageId,
				inboundLinkCountByPageId,
				dirIndexInboundLinkCountByPageId,
			),
		);

		const totalRows = insertRows.length;
		let insertedRows = 0;

		onPhase?.('buildingPages');
		// Sequential, not `eachSplitted`'s concurrent `Promise.all` — SQLite
		// serializes writes on this single transaction's connection anyway,
		// so concurrency buys no throughput here, only two real costs: all
		// ~800 chunk arrays (400k-row archive) live in memory simultaneously
		// instead of one at a time, and `onProgress` (below) would report
		// `insertedRows` in whichever order chunks happened to resolve
		// rather than monotonically — exactly the "must show real progress"
		// property issue #112 exists to guarantee.
		await insertChunked({
			trx,
			table: 'viewer_pages',
			rows: insertRows,
			onChunkInserted: (n) => {
				insertedRows += n;
				onProgress?.({ insertedRows, totalRows });
			},
		});

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
		const directoryTotalRows = directoryNodes.length + directoryPages.length;
		let directoryInsertedRows = 0;
		await insertChunked({
			trx,
			table: 'viewer_directory_nodes',
			rows: directoryNodes,
			onChunkInserted: (n) => {
				directoryInsertedRows += n;
				onProgress?.({
					insertedRows: directoryInsertedRows,
					totalRows: directoryTotalRows,
				});
			},
		});
		await insertChunked({
			trx,
			table: 'viewer_directory_pages',
			rows: directoryPages,
			onChunkInserted: (n) => {
				directoryInsertedRows += n;
				onProgress?.({
					insertedRows: directoryInsertedRows,
					totalRows: directoryTotalRows,
				});
			},
		});

		// Reuses `technologySourceRows` (already loaded above) instead of a
		// second `page_technologies` scan.
		onPhase?.('buildingTechnologySummary');
		const technologySummaryRows = buildTechnologySummaryRows(technologySourceRows);
		const technologyDirectoryStatsRows =
			buildTechnologyDirectoryStatsRows(technologySourceRows);
		const technologyTotalRows =
			technologySummaryRows.length + technologyDirectoryStatsRows.length;
		let technologyInsertedRows = 0;
		await insertChunked({
			trx,
			table: 'viewer_technology_summary',
			rows: technologySummaryRows,
			onChunkInserted: (n) => {
				technologyInsertedRows += n;
				onProgress?.({
					insertedRows: technologyInsertedRows,
					totalRows: technologyTotalRows,
				});
			},
		});
		await insertChunked({
			trx,
			table: 'viewer_technology_directory_stats',
			rows: technologyDirectoryStatsRows,
			onChunkInserted: (n) => {
				technologyInsertedRows += n;
				onProgress?.({
					insertedRows: technologyInsertedRows,
					totalRows: technologyTotalRows,
				});
			},
		});

		onPhase?.('buildingIsolatedComponents');
		const isolatedRows = buildIsolatedReadModelRows(isolatedComponents, pageIdByUrl);
		const isolatedTotalRows = isolatedRows.components.length + isolatedRows.pages.length;
		let isolatedInsertedRows = 0;
		await insertChunked({
			trx,
			table: 'viewer_isolated_components',
			rows: isolatedRows.components,
			onChunkInserted: (n) => {
				isolatedInsertedRows += n;
				onProgress?.({
					insertedRows: isolatedInsertedRows,
					totalRows: isolatedTotalRows,
				});
			},
		});
		await insertChunked({
			trx,
			table: 'viewer_isolated_component_pages',
			rows: isolatedRows.pages,
			onChunkInserted: (n) => {
				isolatedInsertedRows += n;
				onProgress?.({
					insertedRows: isolatedInsertedRows,
					totalRows: isolatedTotalRows,
				});
			},
		});

		onPhase?.('buildingGraph');
		const graphIndegreeByPageId = new Map<number, number>();
		for await (const graphEdgeChunk of computeGraphReadModelRows(
			trx,
			undefined,
			(scannedUpToEdgeId, maxEdgeId) => {
				onProgress?.({ insertedRows: scannedUpToEdgeId, totalRows: maxEdgeId });
			},
		)) {
			for (const edge of graphEdgeChunk) {
				graphIndegreeByPageId.set(
					edge.target_page_id,
					(graphIndegreeByPageId.get(edge.target_page_id) ?? 0) + 1,
				);
			}
			await insertChunked({ trx, table: 'viewer_graph_edges', rows: graphEdgeChunk });
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
		await insertChunked({ trx, table: 'viewer_graph_nodes', rows: graphNodeRows });

		// Independent of `pages`/`anchors` — reads `resources` +
		// `resources-referrers` in bounded chunks (see
		// `computeResourceInsertRows`'s docs for the "one scan, two tables"
		// pattern and its chunking rationale, the same technique as
		// `viewer_anchor_facts`/`viewer_external_links` above).
		onPhase?.('buildingResources');
		for await (const {
			resources: resourceChunk,
			stats: statsChunk,
		} of computeResourceInsertRows(trx, undefined, (scannedUpToId, maxId) => {
			onProgress?.({ insertedRows: scannedUpToId, totalRows: maxId });
		})) {
			await insertChunked({ trx, table: 'viewer_resources', rows: resourceChunk });
			await insertChunked({ trx, table: 'viewer_resource_stats', rows: statsChunk });
		}

		// Resources report "dedupe" mode, precomputed (report-google-sheets
		// performance fix). A second, independent `resource_items` scan (not
		// folded into the `buildingResources` loop above): that loop streams
		// insert rows chunk-by-chunk because each output row corresponds to
		// exactly one input row, but a canonical group's constituent raw
		// resources can appear anywhere across the whole id range, so this
		// pass must finish scanning before any group row is known final (see
		// `computeResourceGroupRows`'s docs). This costs a second full
		// `resource_items` JOIN scan rather than piggybacking on
		// `computeResourceInsertRows`'s already-fetched rows above — accepted
		// because the two loops' row shapes and lifetimes differ enough
		// (streamed 1:1 inserts vs. cross-chunk-accumulated groups) that
		// threading one through the other would tangle two independently
		// testable functions together for a build-time-only saving, while
		// the report-time saving (no re-aggregation per `report` run) that
		// motivated this table already dominates.
		onPhase?.('buildingResourceGroups');
		const resourceGroupRows = await computeResourceGroupRows(
			trx,
			undefined,
			(scannedUpToId, maxId) => {
				onProgress?.({ insertedRows: scannedUpToId, totalRows: maxId });
			},
		);
		await insertChunked({
			trx,
			table: 'viewer_resource_groups',
			rows: resourceGroupRows,
		});

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
		for await (const imageChunk of computeImageInsertRows(
			trx,
			pageUrlRankById,
			undefined,
			(scannedUpToId, maxId) => {
				onProgress?.({ insertedRows: scannedUpToId, totalRows: maxId });
			},
		)) {
			await insertChunked({ trx, table: 'viewer_images', rows: imageChunk });
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
		let headerCheckInsertedRows = 0;
		await insertChunked({
			trx,
			table: 'viewer_header_checks',
			rows: headerCheckRows,
			onChunkInserted: (n) => {
				headerCheckInsertedRows += n;
				onProgress?.({
					insertedRows: headerCheckInsertedRows,
					totalRows: headerCheckRows.length,
				});
			},
		});

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
		await insertChunked({
			trx,
			table: 'viewer_duplicate_groups',
			rows: duplicateGroupRows,
		});
		for await (const duplicateGroupPageChunk of computeDuplicateGroupPageRows(
			trx,
			groupIdByValue,
			undefined,
			(scannedUpToId, maxId) => {
				onProgress?.({ insertedRows: scannedUpToId, totalRows: maxId });
			},
		)) {
			await insertChunked({
				trx,
				table: 'viewer_duplicate_group_pages',
				rows: duplicateGroupPageChunk,
			});
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
		for await (const mismatchChunk of computeMismatchInsertRows(
			trx,
			undefined,
			(completedScans, totalScans) => {
				onProgress?.({ insertedRows: completedScans, totalRows: totalScans });
			},
		)) {
			await insertChunked({ trx, table: 'viewer_mismatches', rows: mismatchChunk });
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
		await insertChunked({ trx, table: 'viewer_count_buckets', rows: facetBuckets });

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
		await insertChunked({
			trx,
			table: 'viewer_error_kind_entries',
			rows: errorKindRows.entries,
		});
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

		// Fired before the last insert rather than after it: the phase's real
		// cost is the implicit COMMIT when this transaction callback returns —
		// the whole read model sits in the WAL at this point, and on a large
		// archive flushing it takes long enough to look like a hang without
		// its own label (issue #294).
		onPhase?.('committing');
		await trx('viewer_read_model_meta').insert({
			id: 1,
			schema_version: VIEWER_READ_MODEL_SCHEMA_VERSION,
			built_at: Date.now(),
			source_row_count: total,
		});
	});

	// Fold the WAL back into db.sqlite here, while still on the build's own
	// connection (issue #294): the build just wrote the entire read model
	// into the WAL, and leaving the checkpoint to the caller's later
	// `archive.write()` means a multi-minute synchronous PRAGMA on whichever
	// thread that runs on — for the worker-offloaded build
	// (`buildViewerReadModelInWorker`), that would be the main thread,
	// re-freezing the display the offload exists to keep alive. Running it
	// here keeps the cost on the build thread and turns the caller's own
	// checkpoint into a near-no-op.
	onPhase?.('checkpointing');
	await knex.raw('PRAGMA wal_checkpoint(TRUNCATE)');
}
