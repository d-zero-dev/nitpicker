import type { IsolatedClusterMember, IsolatedComponent } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/archive/archive-accessor';
import type { PageSource } from '@nitpicker/archive/types';

import { createIsolatedClusterRun } from '@nitpicker/archive/isolated-cluster/create-isolated-cluster-run';
import { releaseFinishedStatements } from '@nitpicker/archive/release-finished-statements';

import { requireAliasOfIdColumn } from './require-alias-of-id-column.js';
import { SQLITE_IN_CHUNK } from './sqlite-in-chunk.js';

/**
 * Compute all connected components of the **inventory-* subgraph**:
 *
 * - Nodes = internal HTML pages with `source IN ('inventory-seed',
 *   'inventory-discovered')` that are themselves canonical
 *   (`redirectDestId IS NULL`). Archived roots are NOT excluded here —
 *   roots are by definition `'crawled'`, so this filter already keeps them
 *   out without any explicit roots check.
 * - Edges = anchors whose **redirect-resolved final destination** is also
 *   in the candidate set. Each anchor `<a href="X">` from page S, where X
 *   may be a redirect-source pointing through one or more hops to a
 *   canonical destination D, contributes an undirected edge `S — D` when
 *   D is itself inventory-*. Anchors whose resolved target leaves the
 *   inventory subgraph (e.g. lands on a `'crawled'` page, or on an
 *   external page) are ignored: per the user's model an inventory-* node
 *   that anchors *out* to the main crawled graph remains in its own
 *   isolated component, since the **inbound** graph is what defines
 *   reachability.
 *
 * Connectivity is **weakly connected** (anchor direction ignored): if
 * X anchors to Y or Y anchors to X, they belong to the same component.
 * This matches the user's intent for navigations like "next/prev archive
 * page" where the pair forms a single isolated group regardless of which
 * end carries the explicit link.
 *
 * Returned components are ordered by their smallest member page id, so the
 * order (and the `component_id` the read model derives from it) does not
 * depend on SQLite's row order. Callers (`listIsolatedClusters` etc.) apply
 * their own display sort order.
 *
 * **Edges are never held.** The candidate pages' anchors are read from
 * `anchor_edges` in chunks of `SQLITE_IN_CHUNK` page ids, and each chunk is
 * joined into the native union-find (`createIsolatedClusterRun`) as it
 * arrives and then dropped, so the memory follows the number of pages and
 * redirect/alias rows, not the number of anchors. The components do not
 * depend on the order edges are joined in. Chunks are read one after
 * another, not concurrently, so at most one chunk's rows are alive.
 *
 * **Why the edge read stays a chunked `page_id IN (...)` query.** A SQL
 * push-down variant was benchmarked (`scripts/bench-isolated.mjs`): a CTE
 * that filters anchors to inventory-* edges via 3 JOINs + LEFT JOIN
 * redirect resolution returned 1,216 edges (vs 5.1M for the chunked path on
 * a 66k-inventory-page archive) but cost 11.6s end-to-end — slower than the
 * chunked `SELECT anchors.pageId, anchors.hrefId WHERE pageId IN (...)`
 * path at 8.7s, because the planner cannot use any single index to satisfy
 * the 3-JOIN chain on this archive shape. Further wins there would require
 * either a denormalised `isolated_root` column on pages (schema change) or
 * a planner hint we cannot express without ANALYZE (forbidden — see the
 * `idx_pages_listfilter` JSDoc). Non-inventory archives short-circuit on the
 * `pageRows.length === 0` early return below.
 *
 * Alias-source rows (`content_items.alias_of_id IS NOT NULL`) get the same
 * treatment as redirect-source rows: excluded from the candidate node set,
 * and any anchor pointing at one is resolved through to its representative
 * before the union — merged into the same hop list handed to the native
 * run, since both columns are simple `id → id` hops and a row never has
 * both set (alias candidates exclude redirect sources by construction). A
 * chain that never ends (a loop, or a tail leading into one) drops the
 * anchor rather than failing the query.
 * @param accessor - The archive accessor to query.
 * @returns Every connected component of the inventory-* subgraph, including singletons.
 * @throws {Error} If `content_items.alias_of_id` does not exist on this
 *   connection (see `requireAliasOfIdColumn`).
 * @example
 * const components = await computeIsolatedClusters(accessor);
 * const clusters = components.filter((c) => c.size >= 2);
 * const singletons = components.filter((c) => c.size === 1);
 */
export async function computeIsolatedClusters(
	accessor: ArchiveAccessor,
): Promise<IsolatedComponent[]> {
	const knex = accessor.getKnex();
	await requireAliasOfIdColumn(knex);

	// 1. Fetch the candidate node set: inventory-* HTML pages that are
	//    themselves canonical (not redirect-source or alias-source rows).
	//    0.13: read through `content_items` + `page_meta` (for `title`) +
	//    `content_type_refs` (for the `text/html` filter) + `url_refs`.
	const pageRows = (await knex('content_items as ci')
		.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.leftJoin('page_meta as pm', 'pm.page_id', 'ci.id')
		.leftJoin('text_refs as title_ref', 'title_ref.id', 'pm.title_text_id')
		.select(
			'ci.id as id',
			'ur.url as url',
			'title_ref.text as title',
			'ci.status as status',
			'ci.source as source',
		)
		.where({
			'ci.scraped': 1,
			'ci.is_external': 0,
			'ctr.raw': 'text/html',
		})
		.whereIn('ci.source', ['inventory-seed', 'inventory-discovered'])
		.whereNull('ci.redirect_dest_id')
		.whereNull('ci.alias_of_id')
		// The native run numbers components in candidate order, and the read
		// model stores that number as `component_id`. Without an explicit order
		// the number would follow whatever plan SQLite picks.
		.orderBy('ci.id')) as {
		id: number;
		url: string;
		title: string | null;
		status: number | null;
		source: string;
	}[];

	if (pageRows.length === 0) {
		return [];
	}

	// 2. Build the redirect/alias hop list (pageId → destId) once, so the
	//    native run resolves an anchor's destination without re-querying
	//    SQLite. `redirect_dest_id` and `alias_of_id` are merged into a
	//    single list since both are plain `id → id` hops and mutually
	//    exclusive per row.
	//    Read as a `UNION ALL` of two single-column `IS NOT NULL` queries
	//    rather than one `OR`-across-two-columns predicate: EXPLAIN QUERY
	//    PLAN on a real ~450k-row archive showed the `OR` form forces a full
	//    `SCAN content_items` (SQLite won't combine two single-column
	//    indexes for an `OR` across different columns here), while each
	//    `UNION ALL` arm uses its own covering index
	//    (`idx_content_items_redirect_dest_id` / `idx_content_items_alias_of_id`).
	//    `UNION ALL` (not `UNION`) is safe because a row is never both a
	//    redirect source and an alias member, so the two arms cannot overlap.
	const redirectRows = (await knex
		.select('id', knex.raw('"redirect_dest_id" as "redirectDestId"'))
		.from('content_items')
		.whereNotNull('redirect_dest_id')
		.unionAll(
			knex
				.select('id', knex.raw('"alias_of_id" as "redirectDestId"'))
				.from('content_items')
				.whereNotNull('alias_of_id'),
		)) as {
		id: number;
		redirectDestId: number;
	}[];
	// Plain numbers, not a `Uint32Array` filled here: `createIsolatedClusterRun`
	// checks every id on its way into the native array, and a typed array built
	// here would wrap an id above 2**32 silently before that check.
	const hops: number[] = [];
	for (const row of redirectRows) {
		hops.push(row.id, row.redirectDestId);
	}

	// 3. Join the candidates' anchors into the native union-find, one chunk at
	//    a time. The destination column (`href_page_id`) is resolved through
	//    the hops natively and may or may not land back in the candidate set.
	//
	//    Chunked at `SQLITE_IN_CHUNK` to stay under SQLite's variable cap —
	//    a single inventory-* set can comfortably exceed 999 pages on a
	//    real-world server-side URL list.
	const candidateIds = pageRows.map((row) => row.id);
	const run = createIsolatedClusterRun(candidateIds, hops);
	for (let start = 0; start < candidateIds.length; start += SQLITE_IN_CHUNK) {
		// `href_page_id` is `NOT NULL`, so every row is an edge.
		const rows = (await knex('anchor_edges')
			.select('page_id as pageId', 'href_page_id as hrefId')
			.whereIn('page_id', candidateIds.slice(start, start + SQLITE_IN_CHUNK))) as {
			pageId: number;
			hrefId: number;
		}[];
		await releaseFinishedStatements();
		const edges: number[] = [];
		for (const row of rows) {
			edges.push(row.pageId, row.hrefId);
		}
		run.unionEdges(edges);
	}

	// 4. Group members by component number (candidate order, so components
	//    come out ordered by their smallest member page id).
	const labels = run.labels();
	const groups: IsolatedClusterMember[][] = [];
	for (const [index, row] of pageRows.entries()) {
		// Tolerate pre-migration archives where the column might be absent —
		// mirrors the `?? 'crawled'` fallback used elsewhere. Cannot actually
		// happen for the IN-filtered set above, but the type widening keeps
		// downstream consumers honest.
		const member: IsolatedClusterMember & { id: number } = {
			id: row.id,
			url: row.url,
			title: row.title,
			status: row.status,
			source: (row.source ?? 'crawled') as PageSource,
		};
		const label = labels[index]!;
		const existing = groups[label];
		if (existing === undefined) {
			groups[label] = [member];
		} else {
			existing.push(member);
		}
	}

	// 5. Build the IsolatedComponent[] result, sorting members by URL ASC
	//    so the lexicographically smallest URL is always at index 0 —
	//    that URL serves as the deterministic representativeUrl identifier.
	return groups.map((members) => {
		members.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
		return {
			representativeUrl: members[0]!.url,
			members,
			size: members.length,
		};
	});
}
