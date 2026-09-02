import type { PageListItem } from '../types.js';

/** One page's data for the Links report sheet — every `content_items` row, skipped or not. */
export interface ContentItemStreamRow {
	/** `content_items.id`. */
	pageId: number;
	/** The page's absolute URL. */
	url: string;
	/** The page's `<title>` text, or `null` when absent/never rendered. */
	title: string | null;
	/** HTTP status code, or `null` for not-yet-classified/errored rows. */
	status: number | null;
	/** HTTP status text (e.g. `"Not Found"`), or `null` when unknown. */
	statusText: string | null;
	/** Raw `Content-Type` response header value, or `null`. */
	contentType: string | null;
	/** `content_items.is_skipped`. */
	isSkipped: boolean;
	/** `content_items.skip_reason`, or `null` when not skipped / unrecorded. */
	skipReason: string | null;
	/** Decoded response headers for this page's `header_set_id`, or `{}` when it has none. */
	responseHeaders: Record<string, string>;
	/**
	 * URLs of every page whose `redirect_dest_id` resolves (after 0.13's
	 * write-time pre-flattening) to this page — i.e. every page that
	 * redirects here. Empty when nothing redirects to this page.
	 */
	redirectFromUrls: readonly string[];
}

/** One image's display fields for the Images report sheet. */
export interface ImageStreamRow {
	/** The URL of the page the image appears on. */
	pageUrl: string;
	/** Resolved `src` attribute value, or `null` for a data-URI/blob-routed image (see `create-cell-data.ts`'s docs on blob-routed values). */
	src: string | null;
	/** Resolved `currentSrc` value, or `null` for a data-URI/blob-routed image. */
	currentSrc: string | null;
	/** `alt` attribute text. */
	alt: string | null;
	/** Displayed width in CSS pixels. */
	width: number;
	/** Displayed height in CSS pixels. */
	height: number;
	/** Whether the image was `loading="lazy"`. */
	isLazy: boolean;
	/** Stable structural DOM locator (e.g. `html/body[1]/main[1]/img[1]`). */
	domPath: string | null;
}

/** One violation's display fields for the Violations report sheet. */
export interface ViolationStreamRow {
	/** Reporting validator name (e.g. "axe", "markuplint"). */
	validator: string;
	/** Severity label as reported by the validator. */
	severity: string;
	/** Rule identifier within the validator. */
	rule: string;
	/** Offending code snippet, or `''` when the validator reported none. */
	code: string;
	/** Human-readable violation message. */
	message: string;
	/** The page URL the violation was reported against. */
	url: string;
}

/** One resource's metadata for the Resources report sheet. */
export interface ResourceStreamRow {
	/** `resource_items.id`. */
	resourceId: number;
	/**
	 * The resource's URL, or `null` for a blob-routed resource (identity is
	 * a large `data:` URI, not a URL — see `resource_items`' url/blob
	 * mutual-exclusion CHECK). Callers decide how to display this case
	 * (the legacy report grouped all such resources under one degenerate
	 * key in dedupe mode).
	 */
	url: string | null;
	/** HTTP status code, or `null` if unknown. */
	status: number | null;
	/** HTTP status text, or `null` if unknown. */
	statusText: string | null;
	/** Raw `Content-Type` response header value, or `null`. */
	contentType: string | null;
	/** Response body size in bytes, or `null` if unknown. */
	contentLength: number | null;
	/**
	 * Number of distinct internal pages referencing this resource — the
	 * same `SUM(resource_ref_edges.count)` semantics `list-resources.ts`
	 * uses (0.13 populates one edge row per unique referrer with
	 * `count = 1`, so the sum equals the referrer-page count). Referrer
	 * URLs* are a separate lookup — see
	 * `getResourceReferrerUrlsByResourceIds`.
	 */
	referrerCount: number;
}

/** One `viewer_anchor_facts` edge, resolved for the Referrers Relational Table report sheet. */
export interface AnchorFactEdgeStreamRow {
	/** The resolved (redirect/alias-followed) destination page's URL. */
	destUrl: string;
	/** The referring page's URL. */
	sourceUrl: string;
	/**
	 * The immediate, pre-resolution href target. Equal to {@link destUrl}
	 * unless the referrer linked to a redirect source or alias member —
	 * callers wanting the legacy report's `[REDIRECTED FROM]` note can
	 * compare the two.
	 */
	rawDestUrl: string;
	/** First-wins anchor text for this (source, dest) pair, or `null`. */
	textContent: string | null;
	/** The destination page's HTTP status, or `null` if unknown. */
	status: number | null;
	/** The destination page's HTTP status text, or `null` if unknown. */
	statusText: string | null;
	/** The destination page's raw `Content-Type` header value, or `null`. */
	contentType: string | null;
	/**
	 * Occurrence count collapsed into this edge (see
	 * `AnchorFactInsertRow.count`'s docs) — new in the report rewrite,
	 * replacing the legacy report's one-row-per-raw-anchor grain (this is
	 * one row per unique resolved (source, dest) pair instead).
	 */
	count: number;
}

/** One page's full display fields for the Page List report sheet, plus its id. */
export interface PageListStreamRow extends PageListItem {
	/** The page's `content_items.id` — lets callers resolve link facts/redirects without a second URL-based lookup. */
	pageId: number;
}

/**
 * One directory-prefix filter, parsed into the two `viewer_pages` columns it
 * is matched against.
 *
 * Produced by `parsePageDirectoryPrefix` from either filter spelling a
 * caller may supply (full URL or pathname-only) so both end up as the same
 * pair of column predicates.
 */
export interface PageDirectoryPrefix {
	/**
	 * The `viewer_pages.hostname` value the filter is scoped to (lowercased
	 * by WHATWG URL parsing, port excluded — `viewer_pages` has no port
	 * column), or `null` for a pathname-only filter, which matches the path
	 * on every host in the archive.
	 */
	hostname: string | null;
	/**
	 * The pathname prefix, normalised to a leading slash, collapsed repeated
	 * slashes and no trailing slash (`/blog`), or `''` for a filter that
	 * names a host (or the site root) without narrowing the path.
	 */
	pathname: string;
}

/** Directory-prefix and URL-list filtering shared by every Page List row reader. */
export interface PageListRowFilterOptions {
	/**
	 * Directory-prefix filters. Each entry is either a full URL
	 * (`https://example.com/blog/` — the page's host AND pathname must
	 * match) or a pathname-only prefix (`/blog` — matches that path on every
	 * host, which is what a single-root archive wants and what a multi-root
	 * archive uses to slice the same path across roots).
	 *
	 * A prefix matches the directory's own page (`/blog`) and everything
	 * under it (`/blog/post-1`), but never a sibling that merely shares the
	 * string prefix (`/blogging`). Multiple entries union: a page listed by
	 * any one of them is included. Omitted or empty means no directory
	 * restriction at all.
	 */
	directories?: readonly string[];
	/**
	 * Exact-match URL allowlist, restricting the row set to exactly these
	 * pages. Values must already be normalized to `viewer_pages.url`'s own
	 * form (`ExURL.withoutHashAndAuth`, computed with the archive's
	 * `disableQueries` setting) — see `resolvePageListUrlFilter`, which every
	 * caller of this option is expected to run first. Unlike `directories`,
	 * this is an AND restriction layered on top of the existing base
	 * restriction and any `directories` filter, not combined as a union: a page
	 * must satisfy both. Omitted or empty means no URL restriction at all
	 * (`applyEqualityOrInFilter`'s empty-array-is-no-filter contract) — never
	 * pass an empty array when the caller's intent was "match nothing".
	 */
	urls?: readonly string[];
}

/** {@link PageListRowFilterOptions} plus the streaming-only read size. */
export interface StreamPageListRowsOptions extends PageListRowFilterOptions {
	/** `viewer_pages` rows read per chunk. Must be positive. */
	chunkSize?: number;
}

/** One page's sub-resource tallies for a report's "resource files" column. */
export interface ResourceFileCounts {
	/**
	 * Every resource this page references — one `resource_ref_edges` row per
	 * distinct resource (the table's `(resource_id, page_id)` primary key
	 * makes this a distinct-resource count, not an occurrence count), no
	 * matter what the fetch result was.
	 */
	total: number;
	/**
	 * The subset of {@link total} whose `resource_items.status` is 200..399 —
	 * i.e. the resource was actually served (2xx) or redirected (3xx). A
	 * `null` status (never fetched / fetch failed before a response) counts
	 * as missing, as does any 4xx/5xx.
	 */
	exists: number;
}

/** One (resource, referring page) pair for the Resources Relational Table report sheet. */
export interface ResourceReferrerEdgeStreamRow {
	/** The referring page's URL. */
	pageUrl: string;
	/**
	 * The resource's URL, or `null` for a blob-routed resource (identity is
	 * a large `data:` URI, not a URL).
	 */
	resourceUrl: string | null;
	/** The resource's HTTP status, or `null` if unknown. */
	status: number | null;
	/** The resource's HTTP status text, or `null` if unknown. */
	statusText: string | null;
	/** The resource's raw `Content-Type` header value, or `null`. */
	contentType: string | null;
	/** The resource's response body size in bytes, or `null` if unknown. */
	contentLength: number | null;
}

/** One resource group's display fields for the Resources report sheet's dedupe mode. */
export interface ResourceGroupStreamRow {
	/** The group's canonicalized URL (query values stripped, keys sorted). */
	canonicalUrl: string;
	/** HTTP status code shared by every resource folded into this group. */
	status: number | null;
	/** HTTP status text — first non-null value observed at build time. */
	statusText: string | null;
	/** Raw `Content-Type` header value shared by every resource in this group. */
	contentType: string | null;
	/** Smallest non-null content length observed. */
	contentLengthMin: number | null;
	/** Largest non-null content length observed. */
	contentLengthMax: number | null;
	/** Number of raw resources collapsed into this group. */
	count: number;
	/** Exact count of distinct pages referencing this group (see `compute-resource-group-rows.ts`'s docs). */
	referrerCount: number;
	/** Newline-joined sample of referrer page URLs (bounded; see `compute-resource-group-rows.ts`), or `null` for a group with no referrers. */
	referrerNote: string | null;
	/** Precomputed `key=N` query-parameter cardinality summary, or `null` for a group with no query string. */
	queryPattern: string | null;
}

/** Per-source-page outbound link tallies for the Page List report sheet. */
export interface OutboundLinkFacts {
	/** Total occurrences of internal links from this page (sum of `viewer_anchor_facts.count`). */
	internalLinks: number;
	/** Occurrences of internal links to a "bad" destination (see the module docs for the threshold). */
	internalBadLinks: number;
	/** Total occurrences of external links from this page. */
	externalLinks: number;
	/** Occurrences of external links to a "bad" destination. */
	externalBadLinks: number;
}

/**
 * One inbound referrer's detail, for the Links report's "Referrers" column.
 *
 * A per-instance consumer of `anchor_edges`' first-wins aggregation (see
 * `anchor_edges`' `UNIQUE(page_id, href_page_id)` dedup docs in
 * ARCHITECTURE.md's invariants): when a referring page links to the same
 * destination more than once (`count > 1`), only the first-observed
 * occurrence's {@link textContent} and {@link redirectedFromUrl} are
 * available — a page that first links directly and later links again via a
 * redirect (or vice versa) is reported as whichever happened first, not
 * both. `count` itself is exact regardless.
 */
export interface InboundReferrerDetail {
	/** The referring page's URL. */
	readonly url: string;
	/** First-wins anchor text for this (source, dest) pair, or `null`. */
	readonly textContent: string | null;
	/**
	 * Occurrence count collapsed into this `viewer_anchor_facts` edge — how
	 * many anchor elements on the referring page point here, matching the
	 * legacy pre-rewrite report's raw per-anchor "N Elements" count (see
	 * `viewer_anchor_facts.count`'s docs). Summing this across every detail
	 * for a page — not counting detail entries — is what the Links report
	 * must use for that column: entries are already deduped to one per
	 * referring page (`viewer_anchor_facts`' own `(source, dest)` grain), so
	 * `.length` alone would undercount a page with more than one anchor to
	 * the same destination.
	 */
	readonly count: number;
	/**
	 * The immediate href-target URL the first-observed occurrence actually
	 * used, before redirect/alias resolution
	 * (`viewer_anchor_facts.raw_dest_url_ref_id`) — `null` when it already
	 * equals the resolved destination (no redirect involved), matching the
	 * legacy report's `[REDIRECTED FROM] ...` note.
	 */
	readonly redirectedFromUrl: string | null;
}
