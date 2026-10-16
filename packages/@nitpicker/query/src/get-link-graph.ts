import type { GetLinkGraphOptions, GraphEdge, GraphNode, LinkGraph } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/archive/archive-accessor';
import type { PageSource } from '@nitpicker/archive/types';

import { requireAliasOfIdColumn } from './require-alias-of-id-column.js';
import { selectMostLinkedTo } from './select-most-linked-to.js';

/**
 * Builds the internal-page-filter predicate for an aliased `content_items`
 * (or ref-joined) surface. 0.13 stores `is_external` / `scraped` as
 * snake_case columns and the MIME lives in `content_type_refs.raw`, so
 * callers must have joined `content_type_refs as <alias>_ctr` before
 * applying this filter.
 * @param ciAlias - The `content_items` alias.
 * @param ctrAlias - The `content_type_refs` alias.
 * @returns A knex `where` object keyed by qualified columns.
 */
function aliasedInternalWhere(
	ciAlias: string,
	ctrAlias: string,
): Record<string, unknown> {
	return {
		[`${ciAlias}.is_external`]: 0,
		[`${ciAlias}.scraped`]: 1,
		[`${ctrAlias}.raw`]: 'text/html',
	};
}

/**
 * Builds the internal-page link graph from the archive.
 *
 * 0.13: nodes come from `content_items` + `url_refs` +
 * `content_type_refs`; edges from `anchor_edges`, which already holds one
 * row per `(page_id, href_page_id)` pair (`UNIQUE`) — and a page has exactly
 * one URL, so those are exactly the distinct `(source URL, target URL)`
 * pairs. Edges are read and counted as page ids; URLs are put back from the
 * node rows, only for the edges that are returned. With `limit`, the nodes
 * kept are the most linked-to ones (`selectMostLinkedTo`, ties in node-row
 * order).
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

	const [pageRows, edgeRows] = (await Promise.all([
		knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
			.select(
				'ci.id as id',
				'ur.url as url',
				'ci.status as status',
				'ci.source as source',
			)
			.where({ 'ci.is_external': 0, 'ci.scraped': 1, 'ctr.raw': 'text/html' })
			.whereNull('ci.redirect_dest_id')
			.whereNull('ci.alias_of_id'),
		// Edges as page ids, not URLs: `UNIQUE(page_id, href_page_id)` already
		// makes each pair one row, and a page has exactly one URL, so no
		// `DISTINCT` over URL strings is needed and the two `url_refs` joins
		// drop out. The URLs are put back from `pageRows` below.
		knex('anchor_edges as ae')
			.join('content_items as source', 'ae.page_id', 'source.id')
			.join('content_items as dest', 'ae.href_page_id', 'dest.id')
			.join('content_type_refs as source_ctr', 'source_ctr.id', 'source.content_type_id')
			.join('content_type_refs as dest_ctr', 'dest_ctr.id', 'dest.content_type_id')
			.select('ae.page_id as sourceId', 'ae.href_page_id as targetId')
			.where(aliasedInternalWhere('source', 'source_ctr'))
			.whereNull('source.redirect_dest_id')
			.whereNull('source.alias_of_id')
			.where(aliasedInternalWhere('dest', 'dest_ctr'))
			.whereNull('dest.redirect_dest_id')
			.whereNull('dest.alias_of_id')
			.whereRaw('"ae"."page_id" != "ae"."href_page_id"'),
	])) as [
		{ id: number; url: string; status: number | null; source: PageSource }[],
		{ sourceId: number; targetId: number }[],
	];

	const indexById = new Map<number, number>();
	for (const [index, row] of pageRows.entries()) {
		indexById.set(row.id, index);
	}

	// Both ends of an edge are nodes, since the edge query applies the same
	// filters as the node query — but the two run as separate statements, so a
	// write landing between them (a crawl appending while this reads) could
	// leave an edge whose end is not in `pageRows`. Such an edge is dropped
	// rather than failing the graph.
	const knownEdges = edgeRows.filter(
		(edge) => indexById.has(edge.sourceId) && indexById.has(edge.targetId),
	);
	const inDegree = new Int32Array(pageRows.length);
	for (const edge of knownEdges) {
		inDegree[indexById.get(edge.targetId)!]!++;
	}

	const toEdge = (edge: { sourceId: number; targetId: number }): GraphEdge => ({
		source: pageRows[indexById.get(edge.sourceId)!]!.url,
		target: pageRows[indexById.get(edge.targetId)!]!.url,
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
		const keptIds = new Set(kept.map((index) => pageRows[index]!.id));
		return {
			nodes: kept.map((index) => toNode(index)),
			edges: knownEdges
				.filter((edge) => keptIds.has(edge.sourceId) && keptIds.has(edge.targetId))
				.map((edge) => toEdge(edge)),
			truncated: true,
		};
	}

	return {
		nodes: pageRows.map((_row, index) => toNode(index)),
		edges: knownEdges.map((edge) => toEdge(edge)),
		truncated: false,
	};
}
