import type { HeaderPresenceKey } from '../types.js';

/**
 * The effective (resolved) sort a header-checks read runs under.
 * `'urlBinary'` is the unset-`sortBy` default (plain BINARY `url_sort_key`
 * order, matching `checkHeaders`'s own unset default); `'urlNatural'` is
 * what an explicit `sortBy: 'url'` request resolves to (natural
 * numeric-aware order via `natural_url_rank`, matching `checkHeaders`'s
 * explicit-`'url'` `orderByUrlRank` behaviour). The two are genuinely
 * different orders, so they carry distinct effective values — collapsing
 * them would make the two genuinely different orders indistinguishable, so
 * neither could be served from the read model (the same split
 * `MismatchesEffectiveSortBy` documents).
 * The four {@link HeaderPresenceKey} values sort on their boolean columns
 * directly, matching `checkHeaders`'s own per-flag sort support.
 */
export type HeaderChecksEffectiveSortBy = 'urlBinary' | 'urlNatural' | HeaderPresenceKey;

/**
 * The columns (in tuple order) that make up a given sort's keyset — both the
 * `ORDER BY` clause and the cursor comparison tuple. Always ends in
 * `page_id`, the stable tie-breaker.
 */
export type HeaderChecksSortColumn =
	| 'url_sort_key'
	| 'natural_url_rank'
	| 'has_csp'
	| 'has_x_frame_options'
	| 'has_x_content_type_options'
	| 'has_hsts'
	| 'page_id';

/**
 * Resolved sort plan for one effective sort: which `viewer_header_checks`
 * columns form the keyset tuple, and which physical scan direction reads
 * them in display order. Every tuple ends in `page_id`, the stable
 * tie-breaker.
 */
export interface HeaderChecksSortSpec {
	/** Keyset tuple columns, in comparison/`ORDER BY` order. */
	readonly columns: readonly HeaderChecksSortColumn[];
	/** Physical scan direction that yields display order for `columns`. */
	readonly scanDirection: 'asc' | 'desc';
}

/**
 * One `viewer_header_checks` row's worth of keyset column values. Every
 * window read selects all of these regardless of the active sort, so one
 * row shape covers every {@link HeaderChecksSortSpec} tuple.
 */
export interface HeaderChecksKeysetRow {
	/** See `viewer_header_checks.page_id`. */
	page_id: number;
	/** See `viewer_header_checks.url_sort_key`. */
	url_sort_key: string;
	/** See `viewer_header_checks.natural_url_rank`. */
	natural_url_rank: number;
	/** See `viewer_header_checks.has_csp`. */
	has_csp: number;
	/** See `viewer_header_checks.has_x_frame_options`. */
	has_x_frame_options: number;
	/** See `viewer_header_checks.has_x_content_type_options`. */
	has_x_content_type_options: number;
	/** See `viewer_header_checks.has_hsts`. */
	has_hsts: number;
}

/**
 * The subset of `ListViewerHeaderChecksOptions` that affects which rows
 * match — used to build a cursor's `filterKey` so a cursor minted under one
 * filter combination can't silently be replayed under another.
 */
export interface HeaderChecksCursorFilterKeyInput {
	/** See `ListViewerHeaderChecksOptions.missingOnly`. */
	missingOnly?: boolean;
	/** See `ListViewerHeaderChecksOptions.hasCSP`. */
	hasCSP?: boolean;
	/** See `ListViewerHeaderChecksOptions.hasXFrameOptions`. */
	hasXFrameOptions?: boolean;
	/** See `ListViewerHeaderChecksOptions.hasXContentTypeOptions`. */
	hasXContentTypeOptions?: boolean;
	/** See `ListViewerHeaderChecksOptions.hasHSTS`. */
	hasHSTS?: boolean;
}

/**
 * Decoded shape of an opaque `/api/headers` viewer cursor.
 */
export interface HeaderChecksCursorPayload {
	/**
	 * The read-model schema version the cursor was minted under (see
	 * `VIEWER_READ_MODEL_SCHEMA_VERSION`).
	 */
	v: number;
	/** See `buildHeaderChecksFilterKey`. */
	filterKey: string;
	/** The effective sort the cursor was minted under. */
	sortBy: HeaderChecksEffectiveSortBy;
	/** The sort direction the cursor was minted under. */
	sortOrder: 'asc' | 'desc';
	/** The boundary row's keyset tuple values, in sort-spec column order. */
	values: (string | number)[];
}
