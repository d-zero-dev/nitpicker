/**
 * The only keyset tuple this cursor family supports: `(edge_id)`.
 * `viewer_anchor_facts`'s `vaf_dest(dest_page_id, edge_id)` index already
 * covers both the `dest_page_id = ?` filter and an `edge_id` order/seek in
 * one index walk, so there is no `sortBy`/`sortOrder`-dependent column
 * switch here — the same "one fixed order" shape
 * `viewer-duplicate-group-pages-cursor` uses.
 */
export interface InboundLinksSortSpec {
	/** Keyset tuple columns, in comparison/`ORDER BY` order. */
	readonly columns: readonly ['edge_id'];
	/** Physical scan direction that yields display order for `columns`. Always `'asc'`. */
	readonly scanDirection: 'asc';
}

/** One `viewer_anchor_facts` row's worth of keyset column values. */
export interface InboundLinksKeysetRow {
	/** See `viewer_anchor_facts.edge_id`. */
	edge_id: number;
}

/**
 * The subset of `ListInboundLinksOptions` that affects which rows match —
 * used to build a cursor's `filterKey` so a cursor minted for one page's
 * inbound links can't silently be replayed against another's.
 */
export interface InboundLinksCursorFilterKeyInput {
	/** The resolved canonical `content_items.id` whose inbound links these are. */
	destPageId: number;
}

/**
 * Decoded shape of an opaque `/api/pages/inbound-links` viewer cursor.
 */
export interface InboundLinksCursorPayload {
	/**
	 * The read-model schema version the cursor was minted under (see
	 * `VIEWER_READ_MODEL_SCHEMA_VERSION`).
	 */
	v: number;
	/** See `buildInboundLinksFilterKey`. */
	filterKey: string;
	/** The sort field the cursor was minted under — always `'edgeId'`. */
	sortBy: 'edgeId';
	/**
	 * The sort direction the cursor was minted under — always `'asc'` at
	 * runtime (see {@link InboundLinksSortSpec}'s docs), but typed as the
	 * shared `'asc' | 'desc'` union to match `decodeCursorEnvelope`'s
	 * generic `CursorEnvelope<SortBy>` return shape.
	 */
	sortOrder: 'asc' | 'desc';
	/** The boundary row's keyset tuple values, in sort-spec column order. */
	values: (string | number)[];
}
