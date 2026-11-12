import type { MismatchType } from '../types.js';

/**
 * The columns (in tuple order) that make up a given sort's keyset — both the
 * `ORDER BY` clause and the cursor comparison tuple. Always ends in
 * `mismatch_id`, the stable tie-breaker.
 */
export type MismatchesSortColumn =
	| 'url_sort_key'
	| 'natural_url_rank'
	| 'actual'
	| 'expected'
	| 'mismatch_id';

/**
 * Resolved sort plan for one `sortBy`/`sortOrder` pair: which
 * `viewer_mismatches` columns form the keyset tuple, and which physical scan
 * direction (`asc`/`desc`) reads them in display order.
 *
 * The unset-`sortBy` default is `url_sort_key` (BINARY collation, matching
 * `findMismatches`'s own unset-`sortBy` plain `ORDER BY url`); an explicit
 * `sortBy: 'url'` maps to `natural_url_rank` instead (natural numeric-aware
 * order, matching `findMismatches`'s explicit-`'url'` `orderByUrlRank`
 * behaviour — the two are genuinely different orders, so both are
 * supported rather than collapsed). `'actual'`/`'expected'` sort on those
 * columns directly.
 */
export interface MismatchesSortSpec {
	/** Keyset tuple columns, in comparison/`ORDER BY` order. */
	readonly columns: readonly MismatchesSortColumn[];
	/** Physical scan direction that yields display order for `columns`. */
	readonly scanDirection: 'asc' | 'desc';
}

/**
 * One `viewer_mismatches` row's worth of keyset column values. Every window
 * read selects all of these regardless of the active sort (see
 * `readMismatchesWindow`'s extra-select list), so a single row shape covers
 * every {@link MismatchesSortSpec} without per-sort narrowing. `actual`/
 * `expected` are typed non-null here because keyset extraction requires it —
 * the build-time non-null/non-empty invariant documented on
 * `viewer_mismatches`'s DDL is what makes that safe.
 */
export interface MismatchesKeysetRow {
	/** See `viewer_mismatches.mismatch_id`. */
	mismatch_id: number;
	/** See `viewer_mismatches.url_sort_key`. */
	url_sort_key: string;
	/** See `viewer_mismatches.natural_url_rank`. */
	natural_url_rank: number;
	/** See `viewer_mismatches.actual` — non-null by build-time invariant. */
	actual: string;
	/** See `viewer_mismatches.expected` — non-null by build-time invariant. */
	expected: string;
}

/**
 * The subset of `ListViewerMismatchesOptions` that affects which rows
 * match — used to build a cursor's `filterKey` so a cursor minted under one
 * `type`/`urlPattern` can't silently be replayed under another.
 */
export interface MismatchesCursorFilterKeyInput {
	/** See `ListViewerMismatchesOptions.type`. */
	type?: MismatchType | MismatchType[];
	/** See `ListViewerMismatchesOptions.urlPattern`. */
	urlPattern?: string;
}

/**
 * The effective (resolved) sort a mismatches read runs under. `'urlBinary'`
 * is the unset-`sortBy` default (plain BINARY `url_sort_key` order, matching
 * `findMismatches`'s own unset default); `'urlNatural'` is what an explicit
 * `sortBy: 'url'` request resolves to (natural numeric-aware order via
 * `natural_url_rank`, matching `findMismatches`'s explicit-`'url'`
 * `orderByUrlRank` behaviour). The two are genuinely different orders, so
 * they carry distinct effective values — collapsing them would make the two
 * genuinely different orders indistinguishable, so neither could be served
 * from the read model.
 */
export type MismatchesEffectiveSortBy =
	| 'urlBinary'
	| 'urlNatural'
	| 'actual'
	| 'expected';

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
	/** The effective sort the cursor was minted under. */
	sortBy: MismatchesEffectiveSortBy;
	/** The sort direction the cursor was minted under. */
	sortOrder: 'asc' | 'desc';
	/** The boundary row's keyset tuple values, in sort-spec column order. */
	values: (string | number)[];
}
