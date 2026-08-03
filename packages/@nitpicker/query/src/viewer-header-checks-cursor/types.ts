/**
 * The only keyset tuple this cursor family supports: `(url_sort_key,
 * page_id)`. `getHeaderChecksFastPath` bails to the live path for any
 * `sortBy` other than `'url'` — URL order is the only order
 * `viewer_header_checks` indexes (`vh_default`/`vh_missing`, see
 * `createViewerReadModelIndexes`) — so unlike
 * `viewer-anchor-facts-cursor`/`viewer-images-cursor` there is no
 * `sortBy`-dependent column switch here.
 */
export interface HeaderChecksSortSpec {
	/** Keyset tuple columns, in comparison/`ORDER BY` order. */
	readonly columns: readonly ['url_sort_key', 'page_id'];
	/** Physical scan direction that yields display order for `columns`. */
	readonly scanDirection: 'asc' | 'desc';
}

/** One `viewer_header_checks` row's worth of keyset column values. */
export interface HeaderChecksKeysetRow {
	/** See `viewer_header_checks.page_id`. */
	page_id: number;
	/** See `viewer_header_checks.url_sort_key`. */
	url_sort_key: string;
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
	/** The sort field the cursor was minted under — always `'url'`. */
	sortBy: 'url';
	/** The sort direction the cursor was minted under. */
	sortOrder: 'asc' | 'desc';
	/** The boundary row's keyset tuple values, in sort-spec column order. */
	values: (string | number)[];
}
