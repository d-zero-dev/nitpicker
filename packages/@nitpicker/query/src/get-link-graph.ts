import type { GetLinkGraphOptions, GraphEdge, GraphNode, LinkGraph } from './types.js';
import type { ArchiveAccessor, PageSource } from '@nitpicker/crawler';

/** Column filter selecting internal, scraped HTML pages (redirects excluded via a separate `whereNull`). */
const INTERNAL_PAGE_WHERE = {
	isExternal: 0,
	scraped: 1,
	contentType: 'text/html',
} as const;

/**
 * Builds the internal-page filter for an aliased `pages` table (the
 * `source`/`dest` joins in the edge query).
 * @param alias - The table alias.
 * @returns A knex `where` object keyed by `<alias>.<column>`.
 */
function aliasedInternalWhere(alias: string): Record<string, unknown> {
	return {
		[`${alias}.isExternal`]: 0,
		[`${alias}.scraped`]: 1,
		[`${alias}.contentType`]: 'text/html',
	};
}

/**
 * Builds the internal-page link graph from the archive.
 *
 * Nodes are internal, scraped, non-redirect HTML pages. Edges are distinct
 * directed links between two such pages (external destinations, non-HTML
 * pages, redirects, and self-links are excluded). Each node's `inDegree`
 * counts its incoming internal links, for use as a visual weight.
 *
 * When `options.limit` is set, only the highest in-degree nodes are kept and
 * edges are filtered to that subset; `truncated` reports whether this happened.
 *
 * **Why `inDegree` is aggregated in JS, not SQL.** A SQL push-down variant
 * (`LEFT JOIN (… GROUP BY dest.id …)`) was benchmarked against a 428k-row
 * archive (`scripts/bench-get-link-graph.mjs`) and was **~10x slower** (38s
 * → 388s) because the aggregate subquery forces SQLite to materialise the
 * full 6M-row anchor join twice — once to count, once to enumerate. The
 * `Map`-based JS aggregation finishes in ~1.5s regardless of edge count,
 * so the JS hot loop is *not* the bottleneck here. The dominant cost is
 * the 6M-row `edgeRows` fetch itself; reducing it further requires either
 * a denormalised `inDegree` column on pages (schema change, out of scope)
 * or accepting partial truncation.
 *
 * **Parallel fetch.** `pageRows` and `edgeRows` are independent — issuing
 * them concurrently via `Promise.all` saves the smaller of the two from
 * the wall-clock (~8s on the bench archive).
 * @param accessor - The archive accessor to query.
 * @param options - Optional node cap.
 * @returns The link graph (nodes + edges + truncated flag).
 */
export async function getLinkGraph(
	accessor: ArchiveAccessor,
	options: GetLinkGraphOptions = {},
): Promise<LinkGraph> {
	const knex = accessor.getKnex();

	const [pageRows, edgeRows] = (await Promise.all([
		knex('pages')
			.select('url', 'status', 'source')
			.where(INTERNAL_PAGE_WHERE)
			.whereNull('redirectDestId'),
		knex('anchors')
			.distinct('source.url as source', 'dest.url as target')
			.join('pages as source', 'anchors.pageId', '=', 'source.id')
			.join('pages as dest', 'anchors.hrefId', '=', 'dest.id')
			.where(aliasedInternalWhere('source'))
			.whereNull('source.redirectDestId')
			.where(aliasedInternalWhere('dest'))
			.whereNull('dest.redirectDestId')
			.whereRaw('anchors.pageId != anchors.hrefId'),
	])) as [
		{ url: string; status: number | null; source: PageSource }[],
		{ source: string; target: string }[],
	];

	const inDegree = new Map<string, number>();
	for (const edge of edgeRows) {
		inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
	}

	let nodes: GraphNode[] = pageRows.map((row) => ({
		url: row.url,
		status: row.status,
		inDegree: inDegree.get(row.url) ?? 0,
		source: row.source,
	}));
	let edges: GraphEdge[] = edgeRows.map((edge) => ({
		source: edge.source,
		target: edge.target,
	}));

	let truncated = false;
	if (options.limit != null && nodes.length > options.limit) {
		nodes = nodes.toSorted((a, b) => b.inDegree - a.inDegree).slice(0, options.limit);
		const kept = new Set(nodes.map((node) => node.url));
		edges = edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target));
		truncated = true;
	}

	return { nodes, edges, truncated };
}
