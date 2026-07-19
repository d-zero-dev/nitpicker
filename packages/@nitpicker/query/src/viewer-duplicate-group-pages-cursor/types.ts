/**
 * The only keyset tuple this cursor family supports: `(url_sort_key,
 * page_id)`. `viewer_duplicate_group_pages` has no dedicated secondary index
 * (its `(group_id, page_id)` `WITHOUT ROWID` primary key already clusters
 * one group's member rows together — see `vdg_field_count`'s JSDoc in
 * `create-viewer-read-model-indexes.ts` for why no separate index is
 * warranted), so there is no `sortOrder`-dependent column switch here, the
 * same "one fixed order" shape `viewer-header-checks-cursor` uses.
 */
export interface DuplicateGroupPagesSortSpec {
	/** Keyset tuple columns, in comparison/`ORDER BY` order. */
	readonly columns: readonly ['url_sort_key', 'page_id'];
	/** Physical scan direction that yields display order for `columns`. Always `'asc'`. */
	readonly scanDirection: 'asc';
}

/** One `viewer_duplicate_group_pages` row's worth of keyset column values. */
export interface DuplicateGroupPagesKeysetRow {
	/** See `viewer_duplicate_group_pages.page_id`. */
	page_id: number;
	/** See `viewer_duplicate_group_pages.url_sort_key`. */
	url_sort_key: string;
}

/**
 * The subset of `ListViewerDuplicateGroupPagesOptions` that affects which
 * rows match — used to build a cursor's `filterKey` so a cursor minted for
 * one group can't silently be replayed against another.
 */
export interface DuplicateGroupPagesCursorFilterKeyInput {
	/** See `ListViewerDuplicateGroupPagesOptions.groupId`. */
	groupId: number;
}

/**
 * Decoded shape of an opaque `/api/duplicates/:groupId/pages` viewer cursor.
 */
export interface DuplicateGroupPagesCursorPayload {
	/**
	 * The read-model schema version the cursor was minted under (see
	 * `VIEWER_READ_MODEL_SCHEMA_VERSION`).
	 */
	v: number;
	/** See `buildDuplicateGroupPagesFilterKey`. */
	filterKey: string;
	/** The sort field the cursor was minted under — always `'url'`. */
	sortBy: 'url';
	/**
	 * The sort direction the cursor was minted under — always `'asc'` at
	 * runtime (see {@link DuplicateGroupPagesSortSpec}'s docs), but typed as
	 * the shared `'asc' | 'desc'` union to match `decodeCursorEnvelope`'s
	 * generic `CursorEnvelope<SortBy>` return shape.
	 */
	sortOrder: 'asc' | 'desc';
	/** The boundary row's keyset tuple values, in sort-spec column order. */
	values: (string | number)[];
}
