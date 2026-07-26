import type { GetLinkGraphOptions, GraphEdge, GraphNode, LinkGraph } from './types.js';
import type { ArchiveAccessor, PageSource } from '@nitpicker/crawler';

import { requireAliasOfIdColumn } from './require-alias-of-id-column.js';

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
 * `content_type_refs`; edges from `anchor_edges` (which already collapses
 * duplicate anchors between the same page pair). Edges are further deduped
 * to distinct `(source.url, dest.url)` pairs via `DISTINCT` because the
 * grouping is at the URL level, not the edge-row level.
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
			.select('ur.url as url', 'ci.status as status', 'ci.source as source')
			.where({ 'ci.is_external': 0, 'ci.scraped': 1, 'ctr.raw': 'text/html' })
			.whereNull('ci.redirect_dest_id')
			.whereNull('ci.alias_of_id'),
		knex('anchor_edges as ae')
			.join('content_items as source', 'ae.page_id', 'source.id')
			.join('content_items as dest', 'ae.href_page_id', 'dest.id')
			.join('url_refs as source_ur', 'source_ur.id', 'source.url_id')
			.join('url_refs as dest_ur', 'dest_ur.id', 'dest.url_id')
			.join('content_type_refs as source_ctr', 'source_ctr.id', 'source.content_type_id')
			.join('content_type_refs as dest_ctr', 'dest_ctr.id', 'dest.content_type_id')
			.distinct('source_ur.url as source', 'dest_ur.url as target')
			.where(aliasedInternalWhere('source', 'source_ctr'))
			.whereNull('source.redirect_dest_id')
			.whereNull('source.alias_of_id')
			.where(aliasedInternalWhere('dest', 'dest_ctr'))
			.whereNull('dest.redirect_dest_id')
			.whereNull('dest.alias_of_id')
			.whereRaw('"ae"."page_id" != "ae"."href_page_id"'),
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
