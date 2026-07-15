/**
 * The columns (in tuple order) that make up a given sort's keyset — both the
 * `ORDER BY` clause and the cursor comparison tuple. Always ends in
 * `edge_id`, the stable tie-breaker.
 */
export type AnchorFactsSortColumn =
	| 'source_url_ref_id'
	| 'dest_url_ref_id'
	| 'status_sort_key'
	| 'status_desc_key'
	| 'edge_id';

/**
 * Resolved sort plan for one `sortBy`/`sortOrder` pair: which
 * `viewer_anchor_facts` columns form the keyset tuple, and which physical
 * scan direction (`asc`/`desc`) reads them in display order.
 *
 * `status` desc uses `status_desc_key` (`= -status_sort_key`) walked
 * ascending, so the `source_url_ref_id`/`edge_id` tie-breakers stay
 * ascending too — ties always display in source-URL order regardless of the
 * primary sort direction, mirroring `viewer_pages`'s identical
 * `ViewerPagesSortSpec` rationale (a row-value keyset tuple comparison
 * can't mix per-column directions, so the descending primary column is
 * negated and walked ascending). `sourceUrl`/`destUrl` use numeric URL ref
 * ids, so their tuple can simply be scanned in the requested direction with
 * `edge_id` as the stable tie-breaker.
 */
export interface AnchorFactsSortSpec {
	/** Keyset tuple columns, in comparison/`ORDER BY` order. */
	readonly columns: readonly AnchorFactsSortColumn[];
	/** Physical scan direction that yields display order for `columns`. */
	readonly scanDirection: 'asc' | 'desc';
}

/** One `viewer_anchor_facts` row's worth of keyset column values, keyed by column name. */
export type AnchorFactsKeysetRow = Record<AnchorFactsSortColumn, string | number> & {
	edge_id: number;
};

/**
 * The `viewer_anchor_facts` columns whose keyset value is a SQLite INTEGER
 * (bound as a JS `number`) rather than TEXT (`string`). Used by
 * `decodeAnchorFactsCursor` to reject a cursor whose `values` array has the
 * right length but a value of the wrong type at some position (e.g. a
 * string where `edge_id` belongs) — SQLite's type-affinity comparison rules
 * would otherwise silently seek to the wrong keyset boundary instead of
 * erroring.
 */
const NUMERIC_ANCHOR_FACTS_SORT_COLUMNS: ReadonlySet<AnchorFactsSortColumn> = new Set([
	'source_url_ref_id',
	'dest_url_ref_id',
	'status_sort_key',
	'status_desc_key',
	'edge_id',
]);

/**
 * Whether `column`'s keyset value is a SQLite INTEGER (`number`) rather
 * than TEXT (`string`).
 * @param column - The sort-spec column to check.
 * @returns `true` for every anchor-facts cursor column.
 */
export function isNumericAnchorFactsSortColumn(column: AnchorFactsSortColumn): boolean {
	return NUMERIC_ANCHOR_FACTS_SORT_COLUMNS.has(column);
}

/**
 * The subset of `ListViewerBrokenLinksOptions` that affects which rows
 * match — used to build a cursor's `filterKey` so a cursor minted under one
 * filter/sort combination can't silently be replayed under another. Unlike
 * `viewer_pages`, `is_broken` itself is never variable here (this cursor
 * family only ever backs the broken-link listing), and `urlPattern` is
 * excluded entirely: it matches source OR destination across two columns
 * (`list-links.ts`'s semantics), which no single index here can satisfy, so
 * the caller (`register-links-route.ts`) forces the legacy fallback instead
 * of ever reaching this cursor machinery with a `urlPattern` set — the same
 * precedent `register-pages-route.ts` already established for `/api/pages`.
 */
export interface AnchorFactsCursorFilterKeyInput {
	/** See `ListViewerBrokenLinksOptions.status`. */
	status?: number;
}

/**
 * Decoded shape of an opaque `/api/links?type=broken` viewer cursor.
 */
export interface AnchorFactsCursorPayload {
	/**
	 * The read-model schema version the cursor was minted under (see
	 * `VIEWER_READ_MODEL_SCHEMA_VERSION`). A schema bump changes column
	 * meanings (or removes them), so a cursor from a stale schema must never
	 * be replayed.
	 */
	v: number;
	/** See `buildAnchorFactsFilterKey`. */
	filterKey: string;
	/** The sort field the cursor was minted under. */
	sortBy: 'sourceUrl' | 'destUrl' | 'status';
	/** The sort direction the cursor was minted under. */
	sortOrder: 'asc' | 'desc';
	/** The boundary row's keyset tuple values, in sort-spec column order. */
	values: (string | number)[];
}
