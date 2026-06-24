import type { IsolatedClusterMember, IsolatedComponent } from './types.js';
import type { ArchiveAccessor, PageSource } from '@nitpicker/crawler';

import { eachSplitted } from '@nitpicker/crawler';

import { resolveRedirectChain } from './resolve-redirect-chain.js';

/**
 * SQLite's default `SQLITE_MAX_VARIABLE_NUMBER` is 999. We chunk `whereIn`
 * batches at 500 to stay safely under that cap — matching the existing
 * pattern used by `Database.getExistingPageUrls` in `@nitpicker/crawler`.
 * On archives with > 999 inventory-* HTML pages a single `whereIn` would
 * throw `SQLITE_ERROR: too many SQL variables`; chunked batching keeps the
 * query correct at any archive size.
 */
const SQLITE_IN_CHUNK = 500;

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
 * Returned components are unsorted; callers (`listIsolatedClusters` etc.)
 * apply their own sort order.
 *
 * Performance: O(N + E + N·α(N)) where N is the inventory-* page count
 * and E is the anchor count touching the candidate set. The redirect chain
 * map is built once from a single `SELECT id, redirectDestId FROM pages
 * WHERE redirectDestId IS NOT NULL` so per-anchor resolution stays
 * memory-resident — no extra SQLite round-trips.
 * @param accessor - The archive accessor to query.
 * @returns Every connected component of the inventory-* subgraph, including singletons.
 */
export async function computeIsolatedClusters(
	accessor: ArchiveAccessor,
): Promise<IsolatedComponent[]> {
	const knex = accessor.getKnex();

	// 1. Fetch the candidate node set: inventory-* HTML pages that are
	//    themselves canonical (not redirect-source rows).
	const pageRows = (await knex('pages')
		.select('id', 'url', 'title', 'status', 'source')
		.where({
			scraped: 1,
			isExternal: 0,
			contentType: 'text/html',
		})
		.whereIn('source', ['inventory-seed', 'inventory-discovered'])
		.whereNull('redirectDestId')) as {
		id: number;
		url: string;
		title: string | null;
		status: number | null;
		source: string;
	}[];

	if (pageRows.length === 0) {
		return [];
	}

	const candidateIds = new Set<number>(pageRows.map((r) => r.id));
	const idToPage = new Map<number, IsolatedClusterMember & { id: number }>();
	for (const row of pageRows) {
		// Tolerate pre-migration archives where the column might be absent —
		// mirrors the `?? 'crawled'` fallback used elsewhere. Cannot actually
		// happen for the IN-filtered set above, but the type widening keeps
		// downstream consumers honest.
		const source = (row.source ?? 'crawled') as PageSource;
		idToPage.set(row.id, {
			id: row.id,
			url: row.url,
			title: row.title,
			status: row.status,
			source,
		});
	}

	// 2. Build the redirect-chain map (pageId → redirectDestId) once, for
	//    O(chain-length) per-anchor resolution without re-querying SQLite.
	const redirectRows = (await knex('pages')
		.select('id', 'redirectDestId')
		.whereNotNull('redirectDestId')) as {
		id: number;
		redirectDestId: number;
	}[];
	const redirectMap = new Map<number, number>();
	for (const r of redirectRows) {
		redirectMap.set(r.id, r.redirectDestId);
	}

	// 3. Fetch anchors whose source page is a candidate. The destination
	//    column (`hrefId`) is resolved through the redirect chain below
	//    and may or may not land back in the candidate set.
	//
	//    Chunked at `SQLITE_IN_CHUNK` to stay under SQLite's variable cap
	//    — a single inventory-* set can comfortably exceed 999 pages on
	//    a real-world server-side URL list.
	const candidateIdList = [...candidateIds];
	const anchorRows: { pageId: number; hrefId: number | null }[] = [];
	await eachSplitted(candidateIdList, SQLITE_IN_CHUNK, async (chunk) => {
		const rows = (await knex('anchors')
			.select('pageId', 'hrefId')
			.whereIn('pageId', chunk)) as {
			pageId: number;
			hrefId: number | null;
		}[];
		anchorRows.push(...rows);
	});

	// 4. Initialise union-find over the candidate set.
	const parent = new Map<number, number>();
	for (const id of candidateIds) {
		parent.set(id, id);
	}
	const find = (x: number): number => {
		let root = x;
		// Path-halving traversal: cheaper than full path compression and
		// keeps the operation iterative (no recursion / stack growth on
		// long chains).
		while (parent.get(root) !== root) {
			const next = parent.get(root) as number;
			parent.set(root, parent.get(next) as number);
			root = parent.get(root) as number;
		}
		return root;
	};
	const union = (a: number, b: number): void => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) {
			parent.set(ra, rb);
		}
	};

	// 5. For each anchor, resolve the destination through redirects. If the
	//    resolved target is itself a candidate (and distinct from the
	//    source — self-anchors don't form clusters), union them.
	for (const a of anchorRows) {
		if (a.hrefId === null) {
			continue;
		}
		const resolved = resolveRedirectChain(a.hrefId, redirectMap);
		if (resolved === null) {
			// Cycle in the chain — skip the edge rather than crash the query.
			continue;
		}
		if (!candidateIds.has(resolved) || resolved === a.pageId) {
			continue;
		}
		union(a.pageId, resolved);
	}

	// 6. Group members by their union-find root to form connected components.
	const groups = new Map<number, IsolatedClusterMember[]>();
	for (const id of candidateIds) {
		const root = find(id);
		const member = idToPage.get(id);
		if (member === undefined) {
			continue;
		}
		const existing = groups.get(root);
		if (existing === undefined) {
			groups.set(root, [member]);
		} else {
			existing.push(member);
		}
	}

	// 7. Build the IsolatedComponent[] result, sorting members by URL ASC
	//    so the lexicographically smallest URL is always at index 0 —
	//    that URL serves as the deterministic representativeUrl identifier.
	const components: IsolatedComponent[] = [];
	for (const members of groups.values()) {
		members.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
		components.push({
			representativeUrl: members[0]!.url,
			members,
			size: members.length,
		});
	}
	return components;
}
