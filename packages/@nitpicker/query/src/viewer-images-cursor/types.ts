/**
 * The columns (in tuple order) that make up a given sort's keyset for
 * `/api/images` — both the `ORDER BY` clause and the cursor comparison
 * tuple. Always ends in `image_id`, the stable tie-breaker.
 *
 * Unlike `viewer_resources`/`viewer_pages`'s `status` sort, none of these
 * primary columns need a `_desc_key` counterpart: each is a single,
 * non-nullable field with no user-visible tie-break ordering requirement, so
 * a `sortOrder: 'desc'` request simply walks the same column/tie-breaker
 * pair in the opposite scan direction (see `getViewerImagesSortSpec`).
 */
export type ViewerImagesSortColumn =
	| 'page_url_rank'
	| 'width'
	| 'height'
	| 'natural_width'
	| 'natural_height'
	| 'is_lazy'
	| 'image_id';

/**
 * Resolved sort plan for one `sortBy`/`sortOrder` pair against
 * `viewer_images`: which columns form the keyset tuple, and which physical
 * scan direction (`asc`/`desc`) reads them in display order.
 */
export interface ViewerImagesSortSpec {
	/** Keyset tuple columns, in comparison/`ORDER BY` order. */
	readonly columns: readonly ViewerImagesSortColumn[];
	/** Physical scan direction that yields display order for `columns`. */
	readonly scanDirection: 'asc' | 'desc';
}

/** One `viewer_images` row's worth of keyset column values, keyed by column name. */
export type ViewerImagesKeysetRow = Record<ViewerImagesSortColumn, string | number> & {
	image_id: number;
};

/**
 * The subset of `ListViewerImagesOptions` (see `../types.js`) that affects
 * which rows match — used to build a cursor's `filterKey` so a cursor minted
 * under one filter/sort combination can't silently be replayed under
 * another.
 */
export interface ViewerImagesCursorFilterKeyInput {
	/** See `ListViewerImagesOptions.missingAlt`. */
	missingAlt?: boolean;
	/** See `ListViewerImagesOptions.missingDimensions`. */
	missingDimensions?: boolean;
	/** See `ListViewerImagesOptions.oversizedThreshold`. */
	oversizedThreshold?: number;
}

/**
 * Decoded shape of an opaque `/api/images` viewer cursor.
 */
export interface ViewerImagesCursorPayload {
	/**
	 * The read-model schema version the cursor was minted under (see
	 * `VIEWER_READ_MODEL_SCHEMA_VERSION`). A schema bump changes column
	 * meanings (or removes them), so a cursor from a stale schema must never
	 * be replayed.
	 */
	v: number;
	/** See `buildViewerImagesFilterKey`. */
	filterKey: string;
	/** The sort field the cursor was minted under. */
	sortBy: 'pageUrl' | 'width' | 'height' | 'naturalWidth' | 'naturalHeight' | 'isLazy';
	/** The sort direction the cursor was minted under. */
	sortOrder: 'asc' | 'desc';
	/** The boundary row's keyset tuple values, in sort-spec column order. */
	values: (string | number)[];
}
