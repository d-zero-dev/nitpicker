import type { ArchiveContext } from './types.js';
import type { LinkGraph } from '@nitpicker/query';

import { getLinkGraph } from '@nitpicker/query';

import { getOrComputeOnDisk } from './precomputed-disk-cache.js';
import { createPromiseLru } from './promise-lru.js';

/**
 * Maximum number of `(archiveId, limit)` cache entries kept in memory.
 * Two ceilings to budget against:
 *
 * - **wall-clock**: `getLinkGraph` is the most expensive viewer query
 *   on a 10 GB archive (~60 s cold) — even a single cache slot pays
 *   that back enormously on warm hits.
 * - **memory**: each entry's JSON shape is bounded by `limit` —
 *   ~66 MB at `limit=1000` (the route default). At 4 entries the
 *   in-memory ceiling is ~250 MB which fits inside the viewer's
 *   default ~4 GB V8 heap without crowding `summary-cache` /
 *   `isolated-clusters-cache` / `referrer-count-cache`.
 *
 * Distinct `limit` values are treated as distinct entries so an
 * operator passing `?limit=0` (uncapped) never serves a capped result
 * to a different caller that asked for `?limit=1000`.
 */
const MAX_ENTRIES = 4;

/**
 * Shared LRU of `LinkGraph` promises keyed by `${archiveId}:${limit ?? 'all'}`.
 * See {@link createPromiseLru} for the dedup / reject-eviction contract.
 */
const lru = createPromiseLru<string, LinkGraph>({ maxEntries: MAX_ENTRIES });

/**
 * Return the (cached) link graph for an archive at a given node cap,
 * computing it on first request and reusing it on subsequent ones.
 *
 * **Why disk persistence is layered on top of the in-memory LRU**: the
 * graph query is the most expensive viewer endpoint on a large archive
 * (60+ s on a 10 GB tar). The in-memory cache only survives the viewer
 * process, so a restart would re-pay that 60 s cost. Persisting the
 * result to the archive's tar-cache directory means the next viewer
 * boots into a sub-millisecond warm hit. The artefact is invalidated
 * implicitly when the archive's content key rolls (PR #98).
 *
 * **Stub-mode bypass**: when `context.mode === 'stub'` the viewer is
 * attached to a live `._nitpicker-*` crawl whose writer keeps
 * appending pages and anchors. A cached snapshot would freeze the
 * graph at first hit and disagree with what the live crawl reports.
 * We therefore recompute every request in stub mode (slow but live),
 * matching the policy of the other archive-mode caches.
 *
 * On computation failure the rejected promise is removed via the
 * shared LRU's reject-eviction so the next request retries cleanly.
 *
 * Read-only — safe against stub-mode archives.
 * @param context - The viewer's per-request archive context.
 * @param limit - Node cap (undefined or 0 → uncapped — accepts the V8
 *   string-limit risk knowingly; the route's default is applied
 *   elsewhere).
 * @returns A promise that resolves to the cached `LinkGraph`.
 */
export async function getCachedLinkGraph(
	context: ArchiveContext,
	limit: number | undefined,
): Promise<LinkGraph> {
	if (context.mode === 'stub') {
		const accessor = context.manager.get(context.archiveId);
		return getLinkGraph(accessor, { limit });
	}
	const key = `${context.archiveId}:${limit ?? 'all'}`;
	return lru.getOrLoad(key, () => {
		const accessor = context.manager.get(context.archiveId);
		// The on-disk filename embeds the cap so two callers asking for
		// different limits cannot share each other's artefact.
		const fileName = `graph-${limit ?? 'all'}`;
		return getOrComputeOnDisk(accessor.tmpDir, fileName, () =>
			getLinkGraph(accessor, { limit }),
		);
	});
}
