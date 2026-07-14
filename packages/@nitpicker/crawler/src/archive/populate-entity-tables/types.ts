/**
 * Domain types for the 0.13 entity/edge population step (issue #193).
 *
 * The 0.13 populate helpers translate rows from the legacy write
 * model (`pages`, `resources`, `anchors`, `images`, `resources-referrers`)
 * into the normalised entity + edge tables (`content_items`, `page_meta`,
 * `resource_items`, `anchor_edges`, `resource_ref_edges`, `image_items`)
 * that 0.13 created. Every ref-id lookup goes through a small set of
 * shared resolvers whose interfaces live here per the repo-wide
 * `型は types.ts に集約` rule.
 */

/**
 * Mapping from `url_refs.url` (the natural key) to `url_refs.id`. Populated
 * on demand from the DB by {@link ./resolve-url-refs.ts}. `null` on values
 * that are stored in {@link ./resolve-blob-refs.ts} instead (large data
 * URIs, see §image `src` / `currentSrc` — URL vs `blob_refs` Routing in
 * the plan) or on lookup miss.
 */
export interface UrlRefResolution {
	/** `url_refs.id` when the URL string is present in the dictionary. */
	readonly urlId: number | null;
	/** `blob_refs.id` when the value is a large data URI routed to blob_refs. */
	readonly blobId: number | null;
}

/**
 * Batch-resolved `text_refs.id` for a set of raw text strings. Keyed by
 * the raw text verbatim so the caller does not need to re-hash for
 * cache probes.
 */
export type TextRefIdMap = ReadonlyMap<string, number>;

/**
 * Batch-resolved `url_refs.id` for a set of URL strings. Keyed by the
 * raw URL verbatim; missing entries mean the URL is either a large data
 * URI (routed to `blob_refs`) or absent from the dictionary — the caller
 * distinguishes via a separate `blob_refs` probe.
 */
export type UrlRefIdMap = ReadonlyMap<string, number>;

/**
 * Batch-resolved `blob_refs.id` for a set of large data URI values.
 * Keyed by the raw value verbatim (the data URI string), consistent with
 * how `populateBlobRefs` inserts one row per distinct data URI payload
 * hash — the resolver looks up by SHA-256 of the decoded payload but
 * returns the map keyed by the raw URI so callers do not have to keep
 * the decoded bytes around.
 */
export type BlobRefIdMap = ReadonlyMap<string, number>;

/**
 * Batch-resolved `content_type_refs.id` for a set of raw content-type
 * header values. Keyed by the raw value exactly as stored in
 * `pages.contentType` / `resources.contentType`; missing entries mean
 * the content type is null or absent from the dictionary (which should
 * not happen after 0.13-0 populates every distinct value).
 */
export type ContentTypeRefIdMap = ReadonlyMap<string, number>;

/**
 * Batch-resolved `header_sets.id` for a set of raw `responseHeaders`
 * JSON strings. Keyed by the raw JSON string; the resolver hashes each
 * value in JS and looks up `header_sets.raw_json_hash` because SQLite
 * has no built-in BLAKE3 / SHA-256 (see
 * {@link ../populate-ref-tables/compute-content-hash.ts} for the algorithm choice).
 */
export type HeaderSetIdMap = ReadonlyMap<string, number>;

/**
 * One collapsed anchor edge produced by the single-pass keyset scan in
 * {@link ./populate-anchor-edges.ts}. Rows are emitted in `(page_id,
 * href_page_id)` order; `first_text_id` is resolved in a second pass
 * after `text_refs` lookups.
 */
export interface AnchorEdgeRow {
	/** `content_items.id` of the page containing the anchor. */
	page_id: number;
	/** `content_items.id` of the anchor target. */
	href_page_id: number;
	/** Number of `anchors` rows collapsed into this edge. */
	count: number;
	/** `first_hash` — the `anchors.hash` of the first (lowest-id) instance. */
	first_hash: string | null;
	/**
	 * `first_text_id` — resolved from `first_textContent` against
	 * `text_refs`. `null` when the first instance had no textContent (an
	 * empty `<a>` tag) or when the text failed to resolve.
	 */
	first_text_id: number | null;
}

/**
 * One input row for {@link ./collapse-anchor-rows.ts}. Every field
 * mirrors the legacy `anchors` schema; the collapser does not depend on
 * knex or the DB so it can be unit-tested with plain arrays.
 */
export interface AnchorInputRow {
	/** Legacy `anchors.id` — used only to sort input; not stored on the edge. */
	id: number;
	/** Legacy `anchors.pageId` — `content_items.id` of the source page. */
	pageId: number;
	/** Legacy `anchors.hrefId` — `content_items.id` of the anchor target. */
	hrefId: number;
	/** Legacy `anchors.hash` — verbatim SHA-256 hex from beholder. */
	hash: string | null;
	/** Legacy `anchors.textContent` — anchor visible text (empty for `<a>` with no content). */
	textContent: string | null;
}

/**
 * Intermediate shape yielded by {@link ./collapse-anchor-rows.ts}. Differs
 * from the final {@link AnchorEdgeRow} in that `first_text_id` has not
 * been resolved yet — the raw text is carried through as
 * `first_textContent` so the second pass can batch-look up every
 * distinct text against `text_refs`.
 */
export interface AnchorEdgeRowInProgress {
	/** `content_items.id` of the page. */
	page_id: number;
	/** `content_items.id` of the anchor target. */
	href_page_id: number;
	/** Number of collapsed `anchors` rows. */
	count: number;
	/** Verbatim `anchors.hash` of the first (lowest-id) instance. */
	first_hash: string | null;
	/**
	 * Verbatim `anchors.textContent` of the first instance — carried
	 * unresolved so the caller can batch-look up ids across every edge.
	 */
	first_textContent: string | null;
}

/**
 * Case discriminator for {@link ./derive-dom-path.ts}: which of the three
 * resolution paths produced the returned `dom_path` string. Used by the
 * populate step to emit a diagnostic warning log for `unknown` fallbacks
 * so operators can audit reconstruction fidelity.
 */
export type DomPathDerivationCase = 'single-match' | 'ordinal-match' | 'unknown';

/**
 * Result of the DOM-path derivation for one legacy `images` row.
 * `path` is the string to insert into `text_refs.text`; `case` records
 * which branch produced it.
 */
export interface DomPathResult {
	/** The `dom_path` string, e.g. `html/body[1]/main[1]/img[3]`. */
	path: string;
	/** Which branch produced the string. */
	case: DomPathDerivationCase;
}
