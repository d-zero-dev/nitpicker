/**
 * The columns (in tuple order) that make up a given sort's keyset for
 * `/api/resources` — both the `ORDER BY` clause and the cursor comparison
 * tuple. Always ends in `resource_id`, the stable tie-breaker.
 */
export type ViewerResourcesSortColumn =
	| 'url_sort_key'
	| 'status_sort_key'
	| 'status_desc_key'
	| 'resource_id';

/**
 * Resolved sort plan for one `sortBy`/`sortOrder` pair against
 * `viewer_resources`: which columns form the keyset tuple, and which
 * physical scan direction (`asc`/`desc`) reads them in display order.
 *
 * `status` desc uses `status_desc_key` (`= -status_sort_key`) walked
 * ascending, so the `url_sort_key`/`resource_id` tie-breakers stay ascending
 * too — the same stable-ordering rationale as `viewer_pages`/
 * `viewer_anchor_facts` (a row-value keyset tuple comparison can't mix
 * per-column directions).
 */
export interface ViewerResourcesSortSpec {
	/** Keyset tuple columns, in comparison/`ORDER BY` order. */
	readonly columns: readonly ViewerResourcesSortColumn[];
	/** Physical scan direction that yields display order for `columns`. */
	readonly scanDirection: 'asc' | 'desc';
}

/** One `viewer_resources` row's worth of keyset column values, keyed by column name. */
export type ViewerResourcesKeysetRow = Record<
	ViewerResourcesSortColumn,
	string | number
> & {
	resource_id: number;
};

/**
 * The subset of `ListViewerResourcesOptions` (see `../types.js`) that affects
 * which rows match — used to build a cursor's `filterKey` so a cursor minted
 * under one filter/sort combination can't silently be replayed under
 * another.
 */
export interface ViewerResourcesCursorFilterKeyInput {
	/** See `ListViewerResourcesOptions.isExternal`. */
	isExternal?: boolean;
	/** See `ListViewerResourcesOptions.status`. */
	status?: number;
}

/**
 * Decoded shape of an opaque `/api/resources` viewer cursor.
 */
export interface ViewerResourcesCursorPayload {
	/**
	 * The read-model schema version the cursor was minted under (see
	 * `VIEWER_READ_MODEL_SCHEMA_VERSION`). A schema bump changes column
	 * meanings (or removes them), so a cursor from a stale schema must never
	 * be replayed.
	 */
	v: number;
	/** See `buildViewerResourcesFilterKey`. */
	filterKey: string;
	/** The sort field the cursor was minted under. */
	sortBy: 'url' | 'status';
	/** The sort direction the cursor was minted under. */
	sortOrder: 'asc' | 'desc';
	/** The boundary row's keyset tuple values, in sort-spec column order. */
	values: (string | number)[];
}
