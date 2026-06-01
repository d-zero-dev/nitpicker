import type { GetLinkGraphOptions, GraphEdge, GraphNode, LinkGraph } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

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
 * @param accessor - The archive accessor to query.
 * @param options - Optional node cap.
 * @returns The link graph (nodes + edges + truncated flag).
 */
export async function getLinkGraph(
	accessor: ArchiveAccessor,
	options: GetLinkGraphOptions = {},
): Promise<LinkGraph> {
	const knex = accessor.getKnex();

	const pageRows = (await knex('pages')
		.select('url', 'status')
		.where(INTERNAL_PAGE_WHERE)
		.whereNull('redirectDestId')) as { url: string; status: number | null }[];

	const edgeRows = (await knex('anchors')
		.distinct('source.url as source', 'dest.url as target')
		.join('pages as source', 'anchors.pageId', '=', 'source.id')
		.join('pages as dest', 'anchors.hrefId', '=', 'dest.id')
		.where(aliasedInternalWhere('source'))
		.whereNull('source.redirectDestId')
		.where(aliasedInternalWhere('dest'))
		.whereNull('dest.redirectDestId')
		.whereRaw('anchors.pageId != anchors.hrefId')) as {
		source: string;
		target: string;
	}[];

	const inDegree = new Map<string, number>();
	for (const edge of edgeRows) {
		inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
	}

	let nodes: GraphNode[] = pageRows.map((row) => ({
		url: row.url,
		status: row.status,
		inDegree: inDegree.get(row.url) ?? 0,
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
