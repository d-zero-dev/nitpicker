/**
 * Decoded shape of an opaque `/api/directory-tree/pages` cursor. Scoped to
 * the endpoint's single fixed sort (`page_url_sort_key` ascending, `page_id`
 * tie-breaker) — unlike `viewer-pages-cursor`'s `ViewerPagesCursorPayload`,
 * there is no `sortBy`/`sortOrder`/`filterKey` to validate, since this
 * endpoint supports none of those axes.
 */
export interface DirectoryPagesCursorPayload {
	/** The read-model schema version this cursor was minted under — see `VIEWER_READ_MODEL_SCHEMA_VERSION`. */
	v: number;
	/** The `nodeId` this cursor was minted for. A cursor minted for one directory must never be replayed against another. */
	nodeId: number;
	/** The boundary row's `page_url_sort_key`. */
	pageUrlSortKey: string;
	/** The boundary row's `page_id`. */
	pageId: number;
}
