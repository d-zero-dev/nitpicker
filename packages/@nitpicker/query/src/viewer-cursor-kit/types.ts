/**
 * A resolved keyset sort plan, generic over a table's own sort-column union:
 * which columns form the keyset tuple (both the `ORDER BY` clause and the
 * cursor comparison tuple), and which physical scan direction (`asc`/`desc`)
 * reads them in display order. Always ends in that table's stable
 * tie-breaker id column.
 *
 * Shared by every `viewer_*` read-model table's keyset-cursor module
 * (`viewer-pages-cursor`, `viewer-resources-cursor`,
 * `viewer-unused-resources-cursor`, `viewer-anchor-facts-cursor`,
 * `viewer-images-cursor`) — the tables' sort plans are structurally
 * identical, differing only in their column unions, so they share this one
 * generic shape rather than each declaring its own `{columns, scanDirection}`
 * interface under a table-specific name. The mechanical
 * filter/keyset/order/limit query shape built on top of it is likewise
 * shared; see `read-keyset-window.ts`.
 */
export interface KeysetSortSpec<Column extends string> {
	/** Keyset tuple columns, in comparison/`ORDER BY` order. */
	readonly columns: readonly Column[];
	/** Physical scan direction that yields display order for `columns`. */
	readonly scanDirection: 'asc' | 'desc';
}

/**
 * One row's worth of keyset column values, keyed by column name — generic
 * over a table's own sort-column union. The tie-breaker id column is always
 * a member of `Column` by convention (every `KeysetSortSpec.columns` tuple
 * ends with it), so no separate id-field type parameter is needed.
 */
export type KeysetRow<Column extends string> = Record<Column, string | number>;

/**
 * The opaque cursor payload envelope shared by every keyset-cursor module —
 * generic over a table's own `sortBy` union. `filterKey`/`sortBy`/
 * `sortOrder` let `decodeCursorEnvelope` reject a cursor minted under a
 * different filter/sort combination (replaying one across a changed query
 * would silently seek to a nonsensical position); `v` lets it reject one
 * minted under a stale read-model schema version.
 */
export interface CursorEnvelope<SortBy extends string> {
	/**
	 * The read-model schema version the cursor was minted under (see
	 * `VIEWER_READ_MODEL_SCHEMA_VERSION`). A schema bump changes column
	 * meanings (or removes them), so a cursor from a stale schema must never
	 * be replayed.
	 */
	v: number;
	/** See `buildFilterKey`. */
	filterKey: string;
	/** The sort field the cursor was minted under. */
	sortBy: SortBy;
	/** The sort direction the cursor was minted under. */
	sortOrder: 'asc' | 'desc';
	/** The boundary row's keyset tuple values, in sort-spec column order. */
	values: (string | number)[];
}

/**
 * The current request's identity to validate a decoded {@link CursorEnvelope}
 * against, generic over a table's own `sortBy` union.
 */
export interface ExpectedCursorEnvelope<SortBy extends string> {
	/** See `buildFilterKey`. */
	filterKey: string;
	/** The current request's sort field. */
	sortBy: SortBy;
	/** The current request's sort direction. */
	sortOrder: 'asc' | 'desc';
	/**
	 * The exact number of keyset tuple values `payload.values` must carry —
	 * `getXSortSpec(sortBy, sortOrder).columns.length`. Without this check a
	 * `values` array of the wrong length would reach the keyset predicate's
	 * positional column/value zip and build a malformed SQL comparison,
	 * surfacing as an opaque SQLite error instead of a clear
	 * cursor-validation error.
	 */
	expectedValueCount: number;
	/**
	 * Optional per-position type check, keyed by tuple index — only
	 * `viewer-anchor-facts-cursor` supplies this (its keyset tuple is fully
	 * numeric after URL refs, and a same-length but wrong-typed `values` array could
	 * otherwise silently seek to the wrong boundary via SQLite's
	 * type-affinity comparison rules instead of erroring). Every other table
	 * omits this — their tuples are homogeneous enough that a length
	 * mismatch is the only malformed-`values` shape worth checking.
	 * @param index - The tuple position being checked.
	 * @returns `'number'` or `'string'` — the expected `typeof` for
	 *   `payload.values[index]`.
	 */
	expectedValueTypeAt?: (index: number) => 'number' | 'string';
}

/**
 * A keyset boundary to seek from, passed to `readKeysetWindow` — omit for an
 * unconstrained (initial / offset) read.
 */
export interface KeysetSeek {
	/** `'>'` for a forward (ascending-tuple) seek, `'<'` for a backward one. */
	operator: '>' | '<';
	/** The boundary row's tuple values, in the sort spec's column order. */
	values: readonly (string | number)[];
}
