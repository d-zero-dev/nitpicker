/**
 * Row shape of the `viewer_read_model_meta` singleton table (always exactly
 * one row, `id = 1`). Shared between `hasViewerReadModel` and
 * `getViewerReadModelVersion`, which both probe this table.
 */
export interface ViewerReadModelMetaRow {
	/** Always `1` — enforced by a `CHECK (id = 1)` constraint. */
	id: 1;
	/**
	 * The read-model schema/build version that produced this row. Compared
	 * against `VIEWER_READ_MODEL_SCHEMA_VERSION` by `ensureViewerReadModel`
	 * to decide whether a rebuild is needed.
	 */
	schema_version: number;
	/** Unix epoch milliseconds when this build completed. */
	built_at: number;
	/** Number of rows written to `viewer_pages` during this build. */
	source_row_count: number;
}

/**
 * Minimal row shape `computePageFacetBuckets` needs from each `pages` row to
 * tally dynamic Pages-list filter enum candidates (status / lang /
 * is_external) per content-type category. A structural subset of
 * `build-viewer-read-model.ts`'s private `PagesSourceRow` — kept separate so
 * the facet tally logic doesn't need to import the whole build module.
 */
export interface FacetSourceRow {
	/** HTTP status code, or `null` for not-yet-classified/errored rows. */
	status: number | null;
	/** Raw `Content-Type` response header value, or `null`. */
	contentType: string | null;
	/**
	 * `1`/`0` when known, `null` on legacy rows written before this column
	 * was backfilled.
	 */
	isExternal: number | null;
	/** `<html lang>` tag value, or `null`/`''` when absent. */
	lang: string | null;
}

/**
 * One row to insert into `viewer_count_buckets` for a precomputed Pages-list
 * facet value — see `computePageFacetBuckets`.
 */
export interface FacetBucketRow {
	/** Always `'pages'` for Pages-list facets. */
	scope: 'pages';
	/**
	 * `facet:<dimension>:content_category=<category>` where `dimension` is
	 * `'status'` / `'lang'` / `'is_external'` and `category` is either a real
	 * {@link ContentTypeCategory} or the literal `'default'` (the `'html'` ∪
	 * `'unknown'` view `listViewerPages` resolves to when its
	 * `contentTypeCategory` option is omitted).
	 */
	key: string;
	/** The stringified facet value (`status` code, `lang` tag, or `'0'`/`'1'`). */
	value: string;
	/** Number of `viewer_pages` rows in this build carrying `value` for this key. */
	count: number;
}
