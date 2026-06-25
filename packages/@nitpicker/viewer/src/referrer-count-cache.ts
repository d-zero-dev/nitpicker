import type { ArchiveContext } from './types.js';

import { createPromiseLru } from './promise-lru.js';

/**
 * Maximum number of archive IDs to keep cached `referrerCount` maps
 * for. Matches the sibling `isolated-clusters-cache` ceiling.
 */
const MAX_ENTRIES = 4;

/**
 * Shared LRU of `Map<pageId, referrerCount>` promises keyed by
 * `archiveId`. See `createPromiseLru` for the dedup / LRU / reject-
 * eviction discipline.
 */
const lru = createPromiseLru<string, Map<number, number>>({ maxEntries: MAX_ENTRIES });

/**
 * Return the cached `Map<pageId, referrerCount>` for an archive, or
 * `null` when the viewer is attached to an in-progress crawl (stub
 * mode). The caller then falls back to the per-row correlated
 * subquery — slower but always live.
 *
 * **Why the cache exists.** `listPageLinks` previously issued a
 * per-row referrer subquery whose dominant cost is the anchor JOIN
 * it triggers per page (~33 s on a 10 GB archive). Pulling the
 * aggregate out into a single `GROUP BY` and serving paginated
 * requests from in-memory lookup drops that to sub-second.
 *
 * **Stub-mode bypass.** When viewing a live `._nitpicker-*` stub,
 * the writer keeps appending anchors. A cached snapshot becomes
 * progressively wrong: pages added during the session show
 * `referrerCount = 0`, pages that gained backlinks show stale
 * counts. We return `null` so the route omits
 * `precomputedReferrerCounts` and `listPageLinks` falls back to the
 * always-live correlated subquery.
 *
 * On computation failure the rejected promise is removed (via the
 * shared LRU's reject-eviction) so the next request retries cleanly.
 *
 * Read-only — safe against stub-mode archives.
 * @param context - The viewer's archive context.
 * @returns A Map promise on archive-file mode, or `null` on stub mode.
 */
export async function getCachedReferrerCounts(
	context: ArchiveContext,
): Promise<Map<number, number> | null> {
	if (context.mode === 'stub') {
		return null;
	}
	return lru.getOrLoad(context.archiveId, () => buildReferrerCountMap(context));
}

/**
 * Issue the actual `GROUP BY` for the referrer-count map. Pulled out
 * of the cache helper so the LRU only holds the promise and the
 * compute logic stays unit-testable on its own.
 * @param context - The viewer's archive context.
 * @returns A `Map<pageId, referrerCount>` covering every canonical
 *   page touched by at least one anchor.
 */
async function buildReferrerCountMap(
	context: ArchiveContext,
): Promise<Map<number, number>> {
	const accessor = context.manager.get(context.archiveId);
	const knex = accessor.getKnex();
	// Resolve through `redirectDestId` so anchors pointing at redirect
	// sources count toward their canonical destination. `redirectDestId`
	// is pre-flattened by the crawler (#71), so a single COALESCE is
	// sufficient — no chain walking.
	const rows = (await knex('anchors')
		.join('pages as t', 'anchors.hrefId', '=', 't.id')
		.select(knex.raw('COALESCE("t"."redirectDestId", "t"."id") as "canonicalId"'))
		.count('* as count')
		.groupBy('canonicalId')) as Array<{
		canonicalId: number | bigint;
		count: number | bigint;
	}>;
	const map = new Map<number, number>();
	for (const row of rows) {
		// Number() guards against libsql returning bigint for large
		// archives — without the coerce, downstream `Map.get(row.id)`
		// would silently miss every key on a future driver bump.
		map.set(Number(row.canonicalId), Number(row.count));
	}
	return map;
}
