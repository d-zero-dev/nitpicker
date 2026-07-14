/**
 * Domain types for the 0.13 population step (issue #191). Every
 * shared interface / type alias lives here per the repo-wide
 * `型は types.ts に集約` rule; implementation modules export functions
 * only.
 */

/**
 * Decomposed URL components that populate `url_refs.{scheme,host,port,path,
 * query_hash,fragment}`. All slots are populated in a single pass over the
 * `url` string so callers do not have to re-parse per column.
 */
export interface DecomposedUrl {
	/**
	 * URL scheme without the trailing colon (`https`, `http`, `mailto`, ...).
	 * `null` for URLs that fail `new URL(...)` parsing.
	 */
	scheme: string | null;
	/**
	 * Host lower-cased (`www.example.com`). `null` when the URL has no
	 * `authority` component (e.g. `mailto:`, `data:`, `javascript:`), and
	 * `null` on parse failure.
	 */
	host: string | null;
	/**
	 * TCP port when explicit in the URL; `null` when the URL uses the
	 * scheme default (WHATWG URL normalises default ports away — we do NOT
	 * synthesise a default here because two rows differing only by explicit
	 * vs implicit `:443` should hash to the same URL, and `url_refs.url` is
	 * the natural key, not this column).
	 */
	port: number | null;
	/**
	 * Path portion (`/foo/bar`). `null` when the URL has no path or the
	 * URL uses an opaque scheme whose "pathname" is really an in-band
	 * payload (`data:`, `blob:`, `javascript:`) — see
	 * {@link ../decompose-url.ts} for the opaque-scheme handling.
	 */
	path: string | null;
	/**
	 * 32-byte content hash of the raw query string exactly as it appears in
	 * the URL (`?a=1&b=2` — the leading `?` is stripped before hashing).
	 * `null` when the URL has no query string, when the query string is
	 * empty, or on parse failure.
	 *
	 * Storing the raw query would defeat dedup on tracker URLs whose
	 * per-request query keys blow up dictionary size; the hash retains the
	 * same-URL-⇒-same-row property without the payload.
	 */
	query_hash: Buffer | null;
	/**
	 * Fragment (`#section-2`) with the leading `#` stripped. `null` when
	 * the URL has no fragment or on parse failure.
	 */
	fragment: string | null;
}

/**
 * Successful decode of a `data:` URI: the raw payload bytes.
 */
export interface DecodedDataUri {
	/** Payload bytes after base64 or percent-decoding. */
	bytes: Buffer;
}

/**
 * One header entry after decomposition — flattened out of the parsed JSON
 * `Record<name, string | string[]>` so that:
 *
 * - Multiple values for the same name (e.g. two `Set-Cookie` lines) each
 *   get their own entry with a distinct `occurrence` ordinal starting at 1.
 * - `isVolatile` is pre-computed once per entry (rather than re-looked-up
 *   at hash time) so both `stableHash` and the `header_set_entries`
 *   inserts see identical classification.
 */
export interface HeaderEntry {
	/** Lower-cased header name; comparison and dedup keys always use this form. */
	name: string;
	/** Raw header value (each element of `string[]` inputs becomes one entry). */
	value: string;
	/**
	 * 1-based ordinal among entries sharing the same `name` within one
	 * response. Always `1` for single-value headers; ≥ 2 when a name
	 * repeats (e.g. multiple `Set-Cookie` lines).
	 */
	occurrence: number;
	/** Pre-computed volatility. */
	isVolatile: boolean;
}

/**
 * Result of decomposing one raw `responseHeaders` JSON string into the
 * shape required for `header_sets`, `header_set_entries`, and
 * `header_flags` inserts. `null` results from the decompose helper
 * indicate "no header set to insert" (null / `{}` / parse failure);
 * callers write `header_set_id = null` to the referring row.
 */
export interface DecomposedHeaderSet {
	/**
	 * 32-byte hash of the raw JSON string exactly as stored on the source
	 * row. Populates `header_sets.raw_json_hash` — a temporary column used
	 * by the 0.13 lookup to map an old `pages.responseHeaders` /
	 * `resources.responseHeaders` value back to its `header_sets.id`
	 * without any SQL function call.
	 */
	rawJsonHash: Buffer;
	/**
	 * 32-byte hash of the sorted `name=value` pairs of **all** entries
	 * (stable + volatile). Populates `header_sets.raw_hash` — a UNIQUE
	 * column so a JS-side upsert can dedup on identical decoded sets.
	 */
	rawHash: Buffer;
	/**
	 * 32-byte hash of the sorted `name=value` pairs of stable entries
	 * only. Populates `header_sets.stable_hash` — indexed so 0.13
	 * readers can answer "how many responses share this stable header
	 * profile" without scanning every entry.
	 */
	stableHash: Buffer;
	/**
	 * 32-byte hash of the sorted `name=value` pairs of volatile entries
	 * only, or `null` when the set has no volatile entries. Populates
	 * `header_sets.volatile_hash`.
	 */
	volatileHash: Buffer | null;
	/** Every decomposed entry, ordered by (name, occurrence). */
	entries: readonly HeaderEntry[];
	/** Total entry count — matches `header_sets.entry_count`. */
	entryCount: number;
	/**
	 * Number of stable entries — matches `header_sets.stable_entry_count`.
	 * `volatile_entry_count` is derived as `entry_count - stable_entry_count`
	 * and not stored separately.
	 */
	stableEntryCount: number;
}

/**
 * Shape written into `header_flags` for one `header_set_id`. `has_*`
 * columns are `INTEGER NOT NULL` (0/1) per the 0.13 DDL;
 * `cache_policy` is nullable and holds a compact summary of the
 * `Cache-Control` value (or `null` when absent).
 */
export interface HeaderFlagsRow {
	/** `1` when at least one entry's name equals `content-security-policy`. */
	has_csp: 0 | 1;
	/** `1` when at least one entry's name equals `x-frame-options`. */
	has_x_frame_options: 0 | 1;
	/** `1` when at least one entry's name equals `x-content-type-options`. */
	has_x_content_type_options: 0 | 1;
	/** `1` when at least one entry's name equals `strict-transport-security`. */
	has_hsts: 0 | 1;
	/** `1` when at least one entry's name equals `referrer-policy`. */
	has_referrer_policy: 0 | 1;
	/** `1` when at least one entry's name equals `permissions-policy`. */
	has_permissions_policy: 0 | 1;
	/** `1` when at least one entry's name equals `set-cookie`. */
	has_set_cookie: 0 | 1;
	/**
	 * The `cache-control` value, verbatim, when present; `null` when
	 * absent. Multi-value `Cache-Control` headers are joined with `, ` so
	 * the summary captures every directive without losing per-occurrence
	 * context.
	 */
	cache_policy: string | null;
}

/**
 * Category label attached to each content-type rule. Mirrors the union
 * `ContentTypeCategory` in `@nitpicker/query/src/types.ts` — kept as a
 * plain string literal here so `@nitpicker/crawler`'s 0.13 step
 * does not need to depend on `@nitpicker/query` (which itself depends
 * on this package). If the two copies drift, `classify-content-type.spec.ts`
 * here and `content-type-rules.spec.ts` on the query side will disagree
 * on the same fixture.
 */
export type ContentTypeCategory =
	| 'html'
	| 'pdf'
	| 'csv'
	| 'word'
	| 'excel'
	| 'powerpoint'
	| 'image'
	| 'audio'
	| 'video'
	| 'font'
	| 'css'
	| 'javascript'
	| 'json'
	| 'xml'
	| 'archive'
	| 'text'
	| 'other'
	| 'unknown';
