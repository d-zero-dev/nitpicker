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
	 * {@link ContentTypeCategory} or the literal `'default'` (the `'html'` ∪
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
