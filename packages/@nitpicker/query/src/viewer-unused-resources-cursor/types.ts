import type { PageSource } from '../types.js';

/**
 * The columns (in tuple order) that make up a given sort's keyset for
 * `/api/unused-resources` — both the `ORDER BY` clause and the cursor
 * comparison tuple. Always ends in `resource_id`, the stable tie-breaker.
 */
export type ViewerUnusedResourcesSortColumn =
	| 'url_sort_key'
	| 'status_sort_key'
	| 'status_desc_key'
	| 'source'
	| 'content_type_raw'
	| 'content_length'
	| 'resource_id';

/**
 * Resolved sort plan for one `sortBy`/`sortOrder` pair against the
 * `is_unused = 1` subset of `viewer_resources`: which columns form the
 * keyset tuple, and which physical scan direction (`asc`/`desc`) reads them
 * in display order.
 *
 * `source` (a text categorical column) can't use the negation trick `status`
 * uses, so its tie-breaker (`url_sort_key`) simply follows the same
 * direction as `source` itself — same `viewer_pages.title_sort_key`
 * rationale (text has no numeric negation).
 */
export interface ViewerUnusedResourcesSortSpec {
	/** Keyset tuple columns, in comparison/`ORDER BY` order. */
	readonly columns: readonly ViewerUnusedResourcesSortColumn[];
	/** Physical scan direction that yields display order for `columns`. */
	readonly scanDirection: 'asc' | 'desc';
}

/** One `viewer_resources` row's worth of keyset column values, keyed by column name. */
export type ViewerUnusedResourcesKeysetRow = Record<
	ViewerUnusedResourcesSortColumn,
	string | number
> & {
	resource_id: number;
};

/**
 * The subset of `ListViewerUnusedResourcesOptions` (see `../types.js`) that
 * affects which rows match — used to build a cursor's `filterKey` so a
 * cursor minted under one filter/sort combination can't silently be
 * replayed under another.
 */
export interface ViewerUnusedResourcesCursorFilterKeyInput {
	/** See `ListViewerUnusedResourcesOptions.status`. */
	status?: number | number[];
	/** See `ListViewerUnusedResourcesOptions.source`. */
	source?: PageSource | PageSource[];
	/** See `ListViewerUnusedResourcesOptions.urlPattern`. */
	urlPattern?: string;
	/** See `ListViewerUnusedResourcesOptions.contentType`. */
	contentType?: string;
}

/**
 * Decoded shape of an opaque `/api/unused-resources` viewer cursor.
 */
export interface ViewerUnusedResourcesCursorPayload {
	/**
	 * The read-model schema version the cursor was minted under (see
	 * `VIEWER_READ_MODEL_SCHEMA_VERSION`). A schema bump changes column
	 * meanings (or removes them), so a cursor from a stale schema must never
	 * be replayed.
	 */
	v: number;
	/** See `buildViewerUnusedResourcesFilterKey`. */
	filterKey: string;
	/** The sort field the cursor was minted under. */
	sortBy: 'url' | 'status' | 'source' | 'contentType' | 'contentLength';
	/** The sort direction the cursor was minted under. */
	sortOrder: 'asc' | 'desc';
	/** The boundary row's keyset tuple values, in sort-spec column order. */
	values: (string | number)[];
}
