import type { GetLinkGraphOptions, GraphEdge, GraphNode, LinkGraph } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/archive/archive-accessor';
import type { PageSource } from '@nitpicker/archive/types';

import { createEdgeBuffer } from './create-edge-buffer.js';
import { requireAliasOfIdColumn } from './require-alias-of-id-column.js';
import { scanAnchorEdges } from './scan-anchor-edges.js';
import { selectMostLinkedTo } from './select-most-linked-to.js';

/**
 * Builds the internal-page link graph from the archive.
 *
 * 0.13: nodes come from `content_items` + `url_refs` +
 * `content_type_refs`; edges from `anchor_edges`, which already holds one
 * row per `(page_id, href_page_id)` pair (`UNIQUE`) — and a page has exactly
 * one URL, so those are exactly the distinct `(source URL, target URL)`
 * pairs.
 *
 * **Edges are kept by looking both ends up in the node set**, not by joining
 * `anchor_edges` with `content_items` for each end. An edge belongs to the
 * graph exactly when both of its pages are nodes (the node query applies the
 * very filter the edge's pages must satisfy: internal, scraped, HTML, neither
 * a redirect source nor an alias member) and the two differ, so the lookup
 * gives the same edges as the join. Joining `anchor_edges` with
 * `content_items` for both ends does not scale: on an archive with ten
 * million anchor edges that query does not return in over an hour, while
 * `scanAnchorEdges` reads the same table once in about ten seconds. The edges
 * that pass are held as pairs of node indexes in a typed array
 * (`createEdgeBuffer`, 8 bytes an edge), and URLs are put back from the node
 * rows only for the edges that are returned. Callers should not rely on the
 * order of the returned edges.
 *
 * The nodes and the edges are read by separate statements, not in one
 * transaction (a long read transaction would hold up a crawl that appends to
 * the archive): a page written between the two reads is missing from the graph
 * together with its edges, and an edge whose end is not a node is left out.
 *
 * With `limit`, the nodes kept are the most linked-to ones
 * (`selectMostLinkedTo`, ties in node-row order).
 * Alias members (`content_items.alias_of_id IS NOT NULL`) are dropped
 * entirely from both nodes and edges — the same "drop, don't resolve"
 * treatment already applied to `redirect_dest_id` here — since the
 * representative page's own node/edges already carry the merged traffic.
 * @param accessor - The archive accessor to query.
 * @param options - Optional node cap.
 * @returns The link graph (nodes + edges + truncated flag).
 * @throws {Error} If `content_items.alias_of_id` does not exist on this
 *   connection (see `requireAliasOfIdColumn`).
 * @example
 * // Cap to the 500 highest in-degree pages for a renderable graph:
 * const { nodes, edges, truncated } = await getLinkGraph(accessor, { limit: 500 });
 */
export async function getLinkGraph(
	accessor: ArchiveAccessor,
	options: GetLinkGraphOptions = {},
): Promise<LinkGraph> {
	const knex = accessor.getKnex();
	await requireAliasOfIdColumn(knex);

	const pageRows = (await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
		.select('ci.id as id', 'ur.url as url', 'ci.status as status', 'ci.source as source')
		.where({ 'ci.is_external': 0, 'ci.scraped': 1, 'ctr.raw': 'text/html' })
		.whereNull('ci.redirect_dest_id')
		.whereNull('ci.alias_of_id')) as {
		id: number;
		url: string;
		status: number | null;
		source: PageSource;
	}[];

	const indexById = new Map<number, number>();
	for (const [index, row] of pageRows.entries()) {
		indexById.set(row.id, index);
	}

	// The edges between nodes, as node indexes.
	const nodeEdges = createEdgeBuffer();
	const inDegree = new Int32Array(pageRows.length);
	await scanAnchorEdges({
		knex,
		onChunk: (rows) => {
			for (const { pageId, hrefId } of rows) {
				const from = indexById.get(pageId);
				const to = indexById.get(hrefId);
				if (from === undefined || to === undefined || from === to) {
					continue;
				}
				nodeEdges.add(from, to);
				inDegree[to]!++;
			}
		},
	});

	const toEdge = (from: number, to: number): GraphEdge => ({
		source: pageRows[from]!.url,
		target: pageRows[to]!.url,
	});
	const toNode = (index: number): GraphNode => {
		const row = pageRows[index]!;
		return {
			url: row.url,
			status: row.status,
			inDegree: inDegree[index]!,
			source: row.source,
		};
	};

	if (options.limit != null && pageRows.length > options.limit) {
		const kept = selectMostLinkedTo(inDegree, options.limit);
		const isKept = new Uint8Array(pageRows.length);
		for (const index of kept) {
			isKept[index] = 1;
		}
		const edges: GraphEdge[] = [];
		nodeEdges.each((from, to) => {
			if (isKept[from] === 1 && isKept[to] === 1) {
				edges.push(toEdge(from, to));
			}
		});
		return { nodes: kept.map((index) => toNode(index)), edges, truncated: true };
	}

	const edges: GraphEdge[] = [];
	nodeEdges.each((from, to) => {
		edges.push(toEdge(from, to));
	});
	return { nodes: pageRows.map((_row, index) => toNode(index)), edges, truncated: false };
}
