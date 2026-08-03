import type { MismatchType } from '../types.js';

/**
 * The only keyset tuple this cursor family supports: `(url_sort_key,
 * mismatch_id)`. `getMismatchesFastPath` bails to the legacy path for any
 * `sortBy` other than `'url'` (`viewer_mismatches` only indexes `(type,
 * url_sort_key, mismatch_id)` — see `vm_type_url`'s docs), so unlike
 * `viewer-anchor-facts-cursor`/`viewer-images-cursor` there is no
 * `sortBy`-dependent column switch here — the same shape
 * `viewer-header-checks-cursor` uses.
 */
export interface MismatchesSortSpec {
	/** Keyset tuple columns, in comparison/`ORDER BY` order. */
	readonly columns: readonly ['url_sort_key', 'mismatch_id'];
	/** Physical scan direction that yields display order for `columns`. */
	readonly scanDirection: 'asc' | 'desc';
}

/** One `viewer_mismatches` row's worth of keyset column values. */
export interface MismatchesKeysetRow {
	/** See `viewer_mismatches.mismatch_id`. */
	mismatch_id: number;
	/** See `viewer_mismatches.url_sort_key`. */
	url_sort_key: string;
}

/**
 * The subset of `ListViewerMismatchesOptions` that affects which rows
 * match — used to build a cursor's `filterKey` so a cursor minted under one
 * `type` can't silently be replayed under another.
 */
export interface MismatchesCursorFilterKeyInput {
	/** See `ListViewerMismatchesOptions.type`. */
	type?: MismatchType | MismatchType[];
}

/**
 * Decoded shape of an opaque `/api/mismatches` viewer cursor.
 */
export interface MismatchesCursorPayload {
	/**
	 * The read-model schema version the cursor was minted under (see
	 * `VIEWER_READ_MODEL_SCHEMA_VERSION`).
	 */
	v: number;
	/** See `buildMismatchesFilterKey`. */
	filterKey: string;
	/** The sort field the cursor was minted under — always `'url'`. */
	sortBy: 'url';
	/** The sort direction the cursor was minted under. */
	sortOrder: 'asc' | 'desc';
	/** The boundary row's keyset tuple values, in sort-spec column order. */
	values: (string | number)[];
}
