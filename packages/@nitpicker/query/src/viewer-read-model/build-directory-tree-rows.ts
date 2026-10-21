import type {
	DirectoryNodeInsertRow,
	DirectoryPageInsertRow,
	DirectoryTreeBuildResult,
	DirectoryTreeSourceRow,
} from './types.js';

import { classifyContentType } from '../classify-content-type.js';

import { propagateDescendantCounts } from './propagate-descendant-counts.js';

/**
 * Structure-relevant fields extracted from one {@link DirectoryTreeSourceRow}
 * by {@link parsePageRow}.
 */
interface ParsedPageRow {
	/** The page URL's `host` (hostname:port). */
	host: string;
	/** The directory segment chain this page's directory node lives at, root-to-leaf order. */
	dirSegments: string[];
	/** Copied from the source row's `id`. */
	id: number;
	/** Copied from the source row's `url`. */
	url: string;
	/** Whether `classifyContentType(row.contentType)` is the `html` category. */
	isHtml: boolean;
}

/**
 * Parses one source row's URL into its host and directory-segment chain,
 * applying the trailing-slash boundary rule: a `pathname` NOT ending in `/`
 * has its last segment treated as a page filename (the directory is formed
 * from the preceding segments); a `pathname` ending in `/` (or empty/`/`)
 * has EVERY segment form the directory chain, with the page attaching to
 * that directory itself as an index page. Query strings and hashes never
 * affect this — only `pathname` is consulted.
 * @param row - The source row to parse.
 * @returns The parsed row, or `null` when `row.url` fails `new URL()`
 *   parsing — such rows are skipped from the directory tree entirely (they
 *   remain ordinary `viewer_pages` rows, just outside this feature, mirroring
 *   `build-viewer-read-model.ts`'s `derivePathSortKey` catch-fallback
 *   precedent for legacy/malformed URLs — except here there is no
 *   substitute value, since a tree node requires a real host).
 */
function parsePageRow(row: DirectoryTreeSourceRow): ParsedPageRow | null {
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(row.url);
	} catch {
		return null;
	}
	const segments = parsedUrl.pathname.split('/').filter(Boolean);
	const dirSegments =
		parsedUrl.pathname.endsWith('/') || segments.length === 0
			? segments
			: segments.slice(0, -1);
	return {
		host: parsedUrl.host,
		dirSegments,
		id: row.id,
		url: row.url,
		isHtml: classifyContentType(row.contentType) === 'html',
	};
}

/** The identity/position fields of a directory node that is about to be created (everything but its id). */
interface NewDirectoryNodeFields {
	/** The parent's `node_id`, or `null` for a root. */
	parentNodeId: number | null;
	/** The host this node's tree belongs to. */
	rootKey: string;
	/** The node's depth (root is `0`). */
	depth: number;
	/** The node's own path segment (`''` for the root). */
	name: string;
	/** The node's full path from the root (`'/'` for the root). */
	path: string;
}

/**
 * Creates a fresh directory node row with every count column zeroed —
 * counts are filled in later by the page-attachment loop and
 * `propagateDescendantCounts`.
 * @param params - The node's identity/position fields.
 * @param params.nodeId - The sequential id to assign.
 * @param params.parentNodeId - The parent's `node_id`, or `null` for a root.
 * @param params.rootKey - The host this node's tree belongs to.
 * @param params.depth - The node's depth (root is `0`).
 * @param params.name - The node's own path segment (`''` for the root).
 * @param params.path - The node's full path from the root (`'/'` for the root).
 * @returns A new, empty {@link DirectoryNodeInsertRow}.
 */
function createEmptyNode(
	params: NewDirectoryNodeFields & { nodeId: number },
): DirectoryNodeInsertRow {
	return {
		node_id: params.nodeId,
		parent_node_id: params.parentNodeId,
		root_key: params.rootKey,
		depth: params.depth,
		name: params.name,
		path: params.path,
		name_sort_key: params.name,
		path_sort_key: params.path,
		direct_child_dir_count: 0,
		direct_page_count: 0,
		descendant_page_count: 0,
		internal_descendant_page_count: 0,
		external_descendant_page_count: 0,
		direct_html_page_count: 0,
		descendant_html_page_count: 0,
		has_children: 0,
	};
}

/**
 * Mutable working state threaded through directory-node creation while
 * walking each row's segment chain.
 */
interface DirectoryTreeBuilderState {
	/**
	 * Every node created so far, in creation order. `nodes[i].node_id` is
	 * always `i + 1`, so a `parent_node_id` indexes this array directly.
	 */
	nodes: DirectoryNodeInsertRow[];
	/**
	 * Child lookup per node, parallel to `nodes` (same index): segment
	 * → child node: a trie, so finding a child needs only the segment. Why not
	 * one map keyed by the concatenated `(host, path)`: that builds, and keeps
	 * alive as a key, a full path string for every node just to find it again.
	 */
	childrenByIndex: Map<string, DirectoryNodeInsertRow>[];
	/** Depth-0 node per host (`root_key`). */
	rootByHost: Map<string, DirectoryNodeInsertRow>;
}

/**
 * Appends a node to the state, numbering it with the next sequential id.
 * @param state - The shared builder state, mutated in place.
 * @param fields - The node's identity/position fields (everything but `nodeId`).
 * @returns The new node.
 */
function appendNode(
	state: DirectoryTreeBuilderState,
	fields: NewDirectoryNodeFields,
): DirectoryNodeInsertRow {
	const node = createEmptyNode({ ...fields, nodeId: state.nodes.length + 1 });
	state.nodes.push(node);
	state.childrenByIndex.push(new Map());
	return node;
}

/**
 * Returns the existing depth-0 root node for `host` (representing its `/`),
 * creating it first if this is the first row seen for that host.
 * @param state - The shared builder state, mutated in place.
 * @param host - The host (root_key) whose root node to fetch or create.
 * @returns The host's root node (`path: '/'`, `depth: 0`).
 */
function getOrCreateRootNode(
	state: DirectoryTreeBuilderState,
	host: string,
): DirectoryNodeInsertRow {
	const existing = state.rootByHost.get(host);
	if (existing) {
		return existing;
	}
	const root = appendNode(state, {
		parentNodeId: null,
		rootKey: host,
		depth: 0,
		name: '',
		path: '/',
	});
	state.rootByHost.set(host, root);
	return root;
}

/**
 * Walks `dirSegments` from `host`'s root, creating any missing intermediate
 * directory node along the way (standard filesystem-tree semantics — an
 * ancestor directory exists even when it carries zero direct pages of its
 * own), and returns the final (deepest) directory node the chain resolves
 * to.
 * @param state - The shared builder state, mutated in place.
 * @param host - The host (root_key) this path belongs to.
 * @param dirSegments - The directory segment chain, root-to-leaf order.
 * @returns The directory node at the end of `dirSegments` — the root node
 *   itself when `dirSegments` is empty.
 */
function getOrCreateDirectoryNode(
	state: DirectoryTreeBuilderState,
	host: string,
	dirSegments: readonly string[],
): DirectoryNodeInsertRow {
	let current = getOrCreateRootNode(state, host);
	for (const segment of dirSegments) {
		const children = state.childrenByIndex[current.node_id - 1]!;
		let node = children.get(segment);
		if (!node) {
			node = appendNode(state, {
				parentNodeId: current.node_id,
				rootKey: host,
				depth: current.depth + 1,
				name: segment,
				// A node's `path` is its parent's path plus its own segment; the
				// root's is `/`, so no separate path accumulator is needed.
				path: `${current.path}${segment}/`,
			});
			children.set(segment, node);
			current.direct_child_dir_count += 1;
		}
		current = node;
	}
	return current;
}

/**
 * Pure (no DB access) transform: given every listable page row, builds the
 * full directory-tree forest — one root per eligible host — plus the
 * direct-page memberships, computing every count column in-memory so the
 * viewer's GET endpoints never split URLs or count children/descendants at
 * request time — all derivation cost is paid once at build time, keeping
 * reads to plain indexed SELECTs.
 *
 * Two classes of row are dropped up front, both for the same reason — no page
 * the crawl actually covered sits behind them, so neither may invent a
 * directory node, contribute to a count, or gain a `viewer_directory_pages`
 * membership:
 *
 * - **`status = 404`**: no page exists behind a 404 URL, so a directory whose
 *   pages are all 404s gets no node (the fix-target 404s remain reachable
 *   through the Pages view's status filter, just not through this feature).
 * - **`isExternal` truthy**: `is_external` marks a URL the crawl never took on
 *   as a target — with `fetchExternal` on (the default) such a row exists only
 *   because something linked to it and the HEAD pre-flight recorded its
 *   destination. It is NOT a pure "is this URL inside the scope path" test:
 *   crawl scope is a `(hostname, port, path)` triple (see
 *   `@nitpicker/archive`'s `scope/find-scope-entry.ts`), so `is_external = 1` covers
 *   a different host AND a same-host subpath outside the scope path, while an
 *   out-of-scope URL that an IN-scope request redirects to is deliberately
 *   stored as internal — `updatePage` writes the redirect result under the
 *   destination url carrying the requester's `isExternal`, so a soft-404 error
 *   page at `example.com/error/` reached from `example.com/path/to/x` counts as
 *   covered by the crawl and keeps its own tree node. That is intentional and
 *   consistent with the Pages view, which lists the same row as internal.
 *   Why not admit external rows and let `external_descendant_page_count` carry them:
 *   a crawl scoped to `example.com/path/to/` would sprout a sibling
 *   `example.com/others/` node built purely out of link targets, and its page
 *   count would be unreachable through the tree's own UI — the tree links to
 *   `/pages?directory=…`, which defaults to internal-only, so an
 *   external-only directory would advertise N pages and then list none.
 *   `null` (a legacy pre-backfill row) counts as internal, matching
 *   `toViewerPageInsertRow`'s normalisation.
 *
 * A host therefore reaches the output only by having at least one internal,
 * non-404 row — a domain present purely as a link target (a social-media
 * profile linked from the site, say) contributes nothing, since a directory
 * tree of a domain the crawl never visited has no value. Dropping external
 * rows at the input is what makes that fall out for free rather than needing
 * a separate host-qualification pass.
 *
 * Because the rule keys off "was this taken on as a target" rather than the URL
 * path, the resulting tree can legitimately contain a directory outside the
 * scope path (the redirect-destination case above). That is the intended
 * reading, not a leak.
 *
 * `external_descendant_page_count` is consequently always `0`. The column is
 * retained rather than removed so the read-model table and the public
 * `DirectoryTreeNode` shape stay stable.
 *
 * This trusts `is_external` completely. The writer guards against the one
 * direction that would otherwise mislabel a real page as external (see
 * `insertPage`'s docs in `archive/src/db-ops/pages/write/insert-page.ts`
 * for the mechanism), but this function still has no way to tell a
 * genuinely out-of-scope row from a mislabelled one written before that
 * guard existed, or by some other path that bypasses it — such a row would
 * silently lose its node here. Why not compensate for that in this function:
 * the only available signal is "the row still has HTML", and keying off that
 * would re-admit real link targets whose HEAD happened to return HTML. A read
 * model cannot repair a mislabelled write, so any remaining case of this
 * stays a writer fix, not a read-side heuristic.
 *
 * A root node's `descendant_page_count` therefore counts the pages the crawl
 * took on as targets, and does NOT match `getSummary`'s `totalPages` (which
 * adds external pages back in). It is close to `getSummary`'s `internalPages`
 * but not identical — that counts `is_external = 0` strictly, excluding the
 * legacy `null` rows this function treats as internal, and it does not drop
 * unparseable URLs.
 *
 * Node ids are assigned sequentially (1-based, in tree-build order) by this
 * function itself, so `parent_node_id` links are embedded in the returned
 * plain objects before any DB insert happens — `buildViewerReadModel` bulk
 * inserts the result with these explicit `node_id` values, which SQLite's
 * `INTEGER PRIMARY KEY` accepts exactly like caller-supplied `rowid`s.
 *
 * Memory profile: the entire forest and the page-membership rows are built in
 * memory before returning (no streaming/chunked variant) — one node per
 * directory and one small row per page, not per URL string. Rows are parsed
 * and attached one at a time, so no second array of parsed rows exists, and
 * the node lookup is a trie (a segment → child map per node) rather than a
 * map keyed by every node's full path. Builds run once at crawl end and may
 * take minutes, not milliseconds — only reads have a latency contract.
 * @param rows - Every listable page row — the same `sourceRows` array
 *   `buildViewerReadModel` already loads to populate `viewer_pages`.
 * @returns The directory nodes and direct-page-membership rows to bulk-insert
 *   into `viewer_directory_nodes`/`viewer_directory_pages`.
 */
export function buildDirectoryTreeRows(
	rows: readonly DirectoryTreeSourceRow[],
): DirectoryTreeBuildResult {
	const state: DirectoryTreeBuilderState = {
		nodes: [],
		childrenByIndex: [],
		rootByHost: new Map(),
	};
	const pages: DirectoryPageInsertRow[] = [];
	for (const sourceRow of rows) {
		// A 404 URL has no page behind it, whatever its provenance — drop it so
		// a host whose only internal rows are 404s builds no tree at all.
		// NULL-status legacy rows are not 404s.
		if (sourceRow.status === 404) {
			continue;
		}
		// Known only as a link target, never taken on as a crawl target, so it
		// gets no node. Not a path test — see this function's docs.
		if (sourceRow.isExternal) {
			continue;
		}
		const row = parsePageRow(sourceRow);
		if (!row) {
			continue;
		}
		const node = getOrCreateDirectoryNode(state, row.host, row.dirSegments);
		node.direct_page_count += 1;
		// Every surviving row is internal by construction, so this is the only
		// counter that ever moves — external_descendant_page_count stays 0.
		node.internal_descendant_page_count += 1;
		if (row.isHtml) {
			node.direct_html_page_count += 1;
			// Seeded with this node's own direct-HTML count; propagateDescendantCounts
			// folds children into parents to turn this into a subtree total.
			node.descendant_html_page_count += 1;
		}
		pages.push({ node_id: node.node_id, page_id: row.id, page_url_sort_key: row.url });
	}

	propagateDescendantCounts(state.nodes);

	return { nodes: state.nodes, pages };
}
