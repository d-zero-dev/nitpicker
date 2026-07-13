import type { PageSource } from '../types.js';
import type { ErrorKind } from '@nitpicker/crawler';

/**
 * Row shape of the `viewer_read_model_meta` singleton table (always exactly
 * one row, `id = 1`). Shared between `hasViewerReadModel` and
 * `getViewerReadModelVersion`, which both probe this table.
 */
export interface ViewerReadModelMetaRow {
	/** Always `1` — enforced by a `CHECK (id = 1)` constraint. */
	id: 1;
	/**
	 * The read-model schema/build version that produced this row. Compared
	 * against `VIEWER_READ_MODEL_SCHEMA_VERSION` by `ensureViewerReadModel`
	 * to decide whether a rebuild is needed.
	 */
	schema_version: number;
	/** Unix epoch milliseconds when this build completed. */
	built_at: number;
	/** Number of rows written to `viewer_pages` during this build. */
	source_row_count: number;
}

/**
 * Minimal row shape `computePageFacetBuckets` needs from each `pages` row to
 * tally dynamic Pages-list filter enum candidates (status / lang /
 * is_external) per content-type category. A structural subset of
 * `build-viewer-read-model.ts`'s private `PagesSourceRow` — kept separate so
 * the facet tally logic doesn't need to import the whole build module.
 */
export interface FacetSourceRow {
	/** HTTP status code, or `null` for not-yet-classified/errored rows. */
	status: number | null;
	/** Raw `Content-Type` response header value, or `null`. */
	contentType: string | null;
	/**
	 * `1`/`0` when known, `null` on legacy rows written before this column
	 * was backfilled.
	 */
	isExternal: number | null;
	/** `<html lang>` tag value, or `null`/`''` when absent. */
	lang: string | null;
}

/**
 * One row to insert into `viewer_count_buckets` for a precomputed Pages-list
 * facet value — see `computePageFacetBuckets`.
 */
export interface FacetBucketRow {
	/** Always `'pages'` for Pages-list facets. */
	scope: 'pages';
	/**
	 * `facet:<dimension>:content_category=<category>` where `dimension` is
	 * `'status'` / `'lang'` / `'is_external'` and `category` is either a real
	 * `ContentTypeCategory` or the literal `'default'` (the `'html'` ∪
	 * `'unknown'` view `listViewerPages` resolves to when its
	 * `contentTypeCategory` option is omitted).
	 */
	key: string;
	/** The stringified facet value (`status` code, `lang` tag, or `'0'`/`'1'`). */
	value: string;
	/** Number of `viewer_pages` rows in this build carrying `value` for this key. */
	count: number;
}

/**
 * Minimal shape `buildDirectoryTreeRows` needs from each listable `pages`
 * row. A structural subset of `build-viewer-read-model.ts`'s private
 * `PagesSourceRow` — the same `sourceRows` array already loaded for
 * `viewer_pages` is reused here, so no second `pages` SELECT is issued.
 */
export interface DirectoryTreeSourceRow {
	/** `pages.id` — becomes `viewer_directory_pages.page_id`. */
	id: number;
	/** The page's absolute URL. */
	url: string;
	/**
	 * `1`/`0` when known, `null` on legacy rows written before this column
	 * was backfilled — normalised the same way `toViewerPageInsertRow` does
	 * (`null` counts as internal).
	 */
	isExternal: number | null;
}

/**
 * One row to insert into `viewer_directory_nodes` — a single directory (or
 * the depth-0 root standing for a host's `/`) within one host's directory
 * tree, produced by `buildDirectoryTreeRows`.
 */
export interface DirectoryNodeInsertRow {
	/**
	 * Sequential integer id assigned by `buildDirectoryTreeRows` itself, in
	 * tree-build order, and inserted verbatim as `viewer_directory_nodes`'s
	 * `INTEGER PRIMARY KEY` — SQLite accepts an explicit primary-key value on
	 * insert exactly like a `rowid`, so `parent_node_id` links can reference
	 * sibling rows in this same insert batch without a round-trip.
	 */
	node_id: number;
	/** The parent directory's `node_id`, or `null` for the depth-0 root node of a host's tree. */
	parent_node_id: number | null;
	/** The page URL's `host` (hostname:port) that this tree belongs to. */
	root_key: string;
	/** `0` for the root (path `/`), incrementing by 1 per path segment. */
	depth: number;
	/** This directory's own segment name (e.g. `"2024"` for `/blog/2024/`), or `''` for the depth-0 root. */
	name: string;
	/** This directory's full path from the root, always starting and ending with `/` (e.g. `/blog/2024/`, or `/` for the root). */
	path: string;
	/**
	 * Sort key for `name` — currently `name` verbatim. Kept as a separate
	 * column (rather than sorting on `name` directly) for the same reason
	 * `viewer_pages.url_sort_key`/`title_sort_key` are separate from their
	 * base columns: it is the index target, and future normalisation (e.g.
	 * case-folding) must not require an index rename.
	 */
	name_sort_key: string;
	/** Sort key for `path` — currently `path` verbatim, see {@link DirectoryNodeInsertRow.name_sort_key}. */
	path_sort_key: string;
	/** Count of immediate child directory nodes (not pages) under this node. */
	direct_child_dir_count: number;
	/** Count of pages attached directly to this node (its own boundary/index pages). */
	direct_page_count: number;
	/** Total pages in this node's entire subtree, including its own `direct_page_count`. */
	descendant_page_count: number;
	/** Subset of `descendant_page_count` where the page's `isExternal` is falsy. */
	internal_descendant_page_count: number;
	/** Subset of `descendant_page_count` where the page's `isExternal` is truthy. */
	external_descendant_page_count: number;
	/**
	 * `1` iff `direct_child_dir_count > 0`, `0` otherwise — whether this node
	 * has child DIRECTORIES to expand via `/api/directory-tree/children`.
	 * Deliberately excludes `direct_page_count`: direct pages are a separate
	 * `/api/directory-tree/pages` panel, not additional tree rows, and every
	 * node this builder creates already has at least one page or child
	 * directory, so including `direct_page_count` here would make this
	 * always `1` (see `propagateDescendantCounts`'s docs in
	 * `build-directory-tree-rows.ts`).
	 */
	has_children: number;
}

/**
 * One row to insert into `viewer_directory_pages` — one page attached
 * directly to a directory node (never a descendant further down the tree),
 * produced by `buildDirectoryTreeRows`.
 */
export interface DirectoryPageInsertRow {
	/** The owning directory's `node_id` — a {@link DirectoryNodeInsertRow.node_id}. */
	node_id: number;
	/** The write-model `pages.id` this row represents. */
	page_id: number;
	/** Sort key for this page's URL within its directory — currently the page's full URL verbatim. */
	page_url_sort_key: string;
}

/** Return shape of `buildDirectoryTreeRows`. */
export interface DirectoryTreeBuildResult {
	/** Every directory node across every eligible host's tree. */
	nodes: DirectoryNodeInsertRow[];
	/** Every direct page-to-node membership row. */
	pages: DirectoryPageInsertRow[];
}

/**
 * One row to insert into `viewer_external_links`, one per unique canonical
 * (redirect-resolved) external destination. Produced by
 * `deriveExternalLinkSummaryRows` from the already-computed
 * {@link AnchorFactInsertRow} set — no separate `anchors` scan.
 */
export interface ExternalLinkInsertRow {
	/** `COALESCE(canonical.id, dest.id)` — the canonical destination's `pages.id`. */
	dest_page_id: number;
	/** URL reference for `COALESCE(canonical.url, dest.url)`. */
	dest_url_ref_id: number;
	/** `COALESCE(canonical.status, dest.status)` — the canonical destination's HTTP status, or `null` if unknown. */
	status: number | null;
	/**
	 * The number of distinct internal pages linking to this destination —
	 * the count of {@link AnchorFactInsertRow} rows sharing this
	 * `dest_page_id`, since those rows are already deduplicated one-per-
	 * `(source_page_id, dest_page_id)` pair. Must stay in the same counting
	 * grain as `getPageDetail.inboundLinks` (see that function's docs, #71)
	 * — multiple anchors from the same page count once.
	 */
	referrer_count: number;
}

/**
 * One row to insert into `viewer_anchor_facts`, one per unique
 * `(source_page_id, dest_page_id)` pair — duplicate anchor observations
 * between the same pair collapse into a single row via `count`. Produced by
 * `computeAnchorFactRows`.
 */
export interface AnchorFactInsertRow {
	/** `anchors.pageId` — the referring page's `pages.id`. */
	source_page_id: number;
	/** `COALESCE(canonical.id, dest.id)` — the canonical destination's `pages.id`. */
	dest_page_id: number;
	/** URL reference for the referring page's URL. */
	source_url_ref_id: number;
	/** URL reference for `COALESCE(canonical.url, dest.url)`. */
	dest_url_ref_id: number;
	/** `COALESCE(canonical.status, dest.status)` — the canonical destination's HTTP status, or `null` if unknown. */
	status: number | null;
	/** `status`, or `NULL_STATUS_SENTINEL` when `status` is `null` — see that constant's docs. */
	status_sort_key: number;
	/**
	 * The negation of {@link status_sort_key} — walking this column
	 * ascending yields `status desc` display order while keeping the
	 * `source_url_ref_id`/`edge_id` tie-breakers ascending too, the same
	 * `viewer_pages.status_desc_key` rationale (a row-value keyset tuple
	 * comparison can't mix per-column directions).
	 */
	status_desc_key: number;
	/** Number of raw anchor observations collapsed into this `(source_page_id, dest_page_id)` row. */
	count: number;
	/** `1` iff the canonical destination's status is `404` (see `list-links.ts`'s broken-link scope note — 403/5xx/unknown never count). */
	is_broken: number;
	/**
	 * `1` iff the canonical destination is external. Not indexed — consumed
	 * only by `deriveExternalLinkSummaryRows`'s in-memory pass at build
	 * time, never by an indexed read query.
	 */
	is_external_link: number;
}

/**
 * One row to insert into `viewer_error_kind_entries` — one host×kind pair,
 * the same grain `getErrorKinds` itself aggregates to. Produced by
 * `computeErrorKindInsertRows` from an already-computed `ErrorKindsResult`
 * (`getErrorKinds`) — no message reclassification happens in the
 * read-model build itself.
 */
export interface ErrorKindEntryInsertRow {
	/** Hostname extracted from the failing URL, or `(unknown)`/`(invalid)`. */
	host: string;
	/** The classified cause shared by every failure in this row. */
	kind: ErrorKind;
	/** Total failure records for this host×kind pair. */
	count: number;
	/** `JSON.stringify`d array of representative failing URLs for this pair. */
	sample_urls_json: string;
	/** Failure records for this pair beyond the sample cap; `0` means none were dropped. */
	overflowed_count: number;
}

/**
 * The single row to insert into `viewer_error_kind_meta` — the two
 * archive-wide values (`total_records`, `channel_source`) that describe the
 * breakdown as a whole rather than any one host×kind pair, mirroring
 * `viewer_summary`'s single-row convention.
 */
export interface ErrorKindMetaInsertRow {
	/** Total failure records across every host×kind pair. */
	total_records: number;
	/** Where the error-channel records came from — see `ErrorKindsResult.facets.channelSource`. */
	channel_source: 'crawl_errors' | 'error.log' | 'none';
}

/**
 * Combined insert rows for both `viewer_error_kind_*` tables, produced by
 * `computeErrorKindInsertRows`.
 */
export interface ErrorKindInsertRows {
	/** Rows for `viewer_error_kind_entries`. */
	entries: ErrorKindEntryInsertRow[];
	/** The single row for `viewer_error_kind_meta`. */
	meta: ErrorKindMetaInsertRow;
}

/**
 * One row to insert into `viewer_isolated_components`, representing a single
 * connected component of the inventory-* subgraph (singleton or cluster).
 */
export interface IsolatedComponentInsertRow {
	/** Sequential integer id assigned during the build. */
	component_id: number;
	/** The component's stable identifier — the lexicographically smallest member URL. */
	representative_url: string;
	/** Representative member title, or `null`. */
	representative_title: string | null;
	/** Representative member status, or `null`. */
	representative_status: number | null;
	/** Sort key mirroring `representative_url`. */
	representative_url_sort_key: string;
	/** Sort key mirroring `representative_title`, defaulting `null` to `''`. */
	representative_title_sort_key: string;
	/** `representative_status`, or `NULL_STATUS_SENTINEL` when `null`. */
	representative_status_sort_key: number;
	/** Negated {@link representative_status_sort_key} for descending order. */
	representative_status_desc_key: number;
	/** Component size (`member_count`). */
	size: number;
	/** Negated {@link size} for descending order under ascending index scans. */
	size_desc_key: number;
}

/**
 * One row to insert into `viewer_isolated_component_pages`, representing one
 * member page of a precomputed isolated component.
 */
export interface IsolatedComponentPageInsertRow {
	/** Owning component id — a {@link IsolatedComponentInsertRow.component_id}. */
	component_id: number;
	/** The write-model `pages.id` for this member. */
	page_id: number;
	/** Member URL. */
	url: string;
	/** Member title, or `null`. */
	title: string | null;
	/** Member HTTP status, or `null`. */
	status: number | null;
	/** Provenance label — see {@link PageSource}. */
	source: PageSource;
	/** Sort key mirroring `url`. */
	url_sort_key: string;
	/** Sort key mirroring `title`, defaulting `null` to `''`. */
	title_sort_key: string;
	/** `status`, or `NULL_STATUS_SENTINEL` when `null`. */
	status_sort_key: number;
	/** Negated {@link status_sort_key} for descending order. */
	status_desc_key: number;
}

/**
 * One row to insert into `viewer_graph_nodes`, representing an internal HTML
 * canonical page in the precomputed link graph.
 */
export interface GraphNodeInsertRow {
	/** The write-model `pages.id` for this node. */
	page_id: number;
	/** Page URL. */
	url: string;
	/** Page HTTP status, or `null`. */
	status: number | null;
	/** Number of incoming internal edges in `viewer_graph_edges`. */
	indegree: number;
	/** Provenance label copied from `pages.source` — see `PageSource` in the parent `types.ts`. */
	source: string;
}

/**
 * One row to insert into `viewer_graph_edges`, representing one distinct
 * directed internal link between two `viewer_graph_nodes`.
 */
export interface GraphEdgeInsertRow {
	/** Source page id. */
	source_page_id: number;
	/** Target page id. */
	target_page_id: number;
}

/**
 * One row to insert into `viewer_resources` — one row per `resources` row,
 * produced by `computeResourceInsertRows`.
 */
export interface ResourceInsertRow {
	/** `resources.id`. */
	resource_id: number;
	/** `resources.isExternal`, normalised to `1`/`0`. */
	is_external: number;
	/** `resources.status`, verbatim. */
	status: number | null;
	/** `status`, or `NULL_STATUS_SENTINEL` when `status` is `null` — see that constant's docs. */
	status_sort_key: number;
	/**
	 * The negation of {@link status_sort_key} — same
	 * `viewer_pages.status_desc_key`/`viewer_anchor_facts.status_desc_key`
	 * rationale (a row-value keyset tuple comparison can't mix per-column
	 * directions).
	 */
	status_desc_key: number;
	/** `resources.source`, verbatim. */
	source: PageSource;
	/**
	 * `1` iff `is_external` is falsy and this resource has zero rows in
	 * `resources-referrers` — the same definition `listUnusedResources` uses
	 * (external resources are never "unused" candidates, see that function's
	 * docs).
	 */
	is_unused: number;
	/**
	 * The resource's URL, verbatim — copied at build time so indexed
	 * `ORDER BY`/keyset comparisons don't need a pre-join, the same
	 * rationale as `viewer_pages.url_sort_key`.
	 */
	url_sort_key: string;
}

/**
 * One row to insert into `viewer_resource_stats` — one row per `resources`
 * row, produced by `computeResourceInsertRows` from the same scan that
 * produces {@link ResourceInsertRow}.
 */
export interface ResourceStatsInsertRow {
	/** `resources.id` — a {@link ResourceInsertRow.resource_id}. */
	resource_id: number;
	/** Count of distinct `resources-referrers` rows for this resource. */
	referrer_count: number;
}

/**
 * Combined insert rows for both resource read-model tables, produced by
 * `computeResourceInsertRows` from a single `resources` scan.
 */
export interface ResourceInsertRows {
	/** Rows for `viewer_resources`. */
	resources: ResourceInsertRow[];
	/** Rows for `viewer_resource_stats`. */
	stats: ResourceStatsInsertRow[];
}

/**
 * One row to insert into `viewer_images` (issue #113) — one row per
 * `images` row, produced by `computeImageInsertRows`. Deliberately excludes
 * `src`/`currentSrc`/`alt`/`sourceCode`: those large text columns are never
 * duplicated onto the read model, and are resolved by joining back to
 * `images`/`pages` only after the id set is limit-bounded (see
 * `joinViewerImageIdsToListItems`).
 */
export interface ImageInsertRow {
	/** `images.id`. */
	image_id: number;
	/**
	 * Dense, zero-based rank of `images.pageId` in
	 * `viewer_pages.url_sort_key` ascending order — see
	 * `buildPageUrlRankMap`'s docs for why this small integer surrogate
	 * replaces inlining the page URL text itself. `images.pageId` is not
	 * itself stored as a column here: no query joins `viewer_images` back to
	 * `pages` by page (display joins go through `image_id` instead), so
	 * keeping only its derived rank avoids an otherwise-unread integer
	 * column across ~9.11M rows.
	 */
	page_url_rank: number;
	/** `1` iff `images.alt` is `null` or `''`. */
	missing_alt: number;
	/** `1` iff `images.width` or `images.height` is `0`. */
	missing_dimensions: number;
	/** `images.width`, verbatim. */
	width: number;
	/** `images.height`, verbatim. */
	height: number;
	/** `images.naturalWidth`, verbatim. */
	natural_width: number;
	/** `images.naturalHeight`, verbatim. */
	natural_height: number;
	/**
	 * Normalised `0`/`1` form of `images.isLazy` — coerced the same way
	 * `listImages`'s `mapRow` does (`!!row.isLazy`), so a `null` source value
	 * becomes `0` rather than requiring a nullable sort column.
	 */
	is_lazy: number;
}
