import type { GetLinkGraphOptions, GraphEdge, GraphNode, LinkGraph } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Fast-path counterpart of `getLinkGraph`, backed by
 * `viewer_graph_nodes`/`viewer_graph_edges`.
 * @param accessor - Archive accessor whose read model is current.
 * @param options - Optional node cap; `0` preserves the legacy "empty graph"
 *   semantics of `getLinkGraph({ limit: 0 })`.
 * @returns The internal link graph.
 */
export async function getViewerLinkGraph(
	accessor: ArchiveAccessor,
	options: GetLinkGraphOptions = {},
): Promise<LinkGraph> {
	const knex = accessor.getKnex();
	const requestedLimit = options.limit;

	const countResult = (await knex('viewer_graph_nodes').count('page_id as total')) as {
		total: number;
	}[];
	const totalNodes = Number(countResult[0]?.total ?? 0);

	const nodeQuery = knex('viewer_graph_nodes')
		.select('page_id as pageId', 'url', 'status', 'indegree')
		.orderBy('indegree', 'desc')
		.orderBy('page_id', 'asc');
	if (requestedLimit != null) {
		nodeQuery.limit(requestedLimit);
	}

	const nodeRows = (await nodeQuery) as {
		pageId: number;
		url: string;
		status: number | null;
		indegree: number;
	}[];
	const nodes: GraphNode[] = nodeRows.map((row) => ({
		url: row.url,
		status: row.status,
		inDegree: Number(row.indegree),
	}));
	const truncated = requestedLimit != null && totalNodes > requestedLimit;

	if (nodeRows.length === 0) {
		return { nodes, edges: [], truncated };
	}

	let edgeQuery = knex('viewer_graph_edges as edges')
		.join('viewer_graph_nodes as source', 'edges.source_page_id', '=', 'source.page_id')
		.join('viewer_graph_nodes as target', 'edges.target_page_id', '=', 'target.page_id')
		.select('source.url as source', 'target.url as target')
		.orderBy('edges.source_page_id', 'asc')
		.orderBy('edges.target_page_id', 'asc');

	if (truncated) {
		const nodeIds = nodeRows.map((row) => row.pageId);
		edgeQuery = edgeQuery
			.whereIn('edges.source_page_id', nodeIds)
			.whereIn('edges.target_page_id', nodeIds);
	}

	const edges = (await edgeQuery) as GraphEdge[];
	return { nodes, edges, truncated };
}
