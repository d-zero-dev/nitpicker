/**
 * The only keyset tuple this cursor family supports: `(count_desc_key,
 * group_id)`. Unlike `HeaderChecksSortSpec`/`MismatchesSortSpec`, there is no
 * `sortOrder`-driven direction switch: live `findDuplicates` has no
 * `sortOrder` concept at all (it always returns most-duplicated-group-first),
 * so `viewer_duplicate_groups`'s single `vdg_field_count` index is always
 * walked ascending on `count_desc_key` (the sign-flipped `count`) to yield
 * `count DESC` display order — see `DuplicateGroupInsertRow.count_desc_key`'s
 * docs for the sign-flip convention.
 */
export interface DuplicateGroupsSortSpec {
	/** Keyset tuple columns, in comparison/`ORDER BY` order. */
	readonly columns: readonly ['count_desc_key', 'group_id'];
	/** Physical scan direction that yields display order for `columns`. Always `'asc'`. */
	readonly scanDirection: 'asc';
}

/** One `viewer_duplicate_groups` row's worth of keyset column values. */
export interface DuplicateGroupsKeysetRow {
	/** See `viewer_duplicate_groups.group_id`. */
	group_id: number;
	/** See `viewer_duplicate_groups.count_desc_key`. */
	count_desc_key: number;
}

/**
 * The subset of `ListViewerDuplicateGroupsOptions` that affects which rows
 * match — used to build a cursor's `filterKey` so a cursor minted under one
 * `field` can't silently be replayed under another.
 */
export interface DuplicateGroupsCursorFilterKeyInput {
	/** See `ListViewerDuplicateGroupsOptions.field`. */
	field: 'title' | 'description';
}

/**
 * Decoded shape of an opaque `/api/duplicates` viewer cursor.
 */
export interface DuplicateGroupsCursorPayload {
	/**
	 * The read-model schema version the cursor was minted under (see
	 * `VIEWER_READ_MODEL_SCHEMA_VERSION`).
	 */
	v: number;
	/** See `buildDuplicateGroupsFilterKey`. */
	filterKey: string;
	/** The sort field the cursor was minted under — always `'count'`. */
	sortBy: 'count';
	/**
	 * The sort direction the cursor was minted under — always `'asc'` at
	 * runtime (see {@link DuplicateGroupsSortSpec}'s docs), but typed as the
	 * shared `'asc' | 'desc'` union to match `decodeCursorEnvelope`'s generic
	 * `CursorEnvelope<SortBy>` return shape.
	 */
	sortOrder: 'asc' | 'desc';
	/** The boundary row's keyset tuple values, in sort-spec column order. */
	values: (string | number)[];
}
