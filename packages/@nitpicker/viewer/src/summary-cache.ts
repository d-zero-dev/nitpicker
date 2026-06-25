import type { ArchiveContext } from './types.js';
import type { SummaryResult } from '@nitpicker/query';

import { getSummary } from '@nitpicker/query';

import { getOrComputeOnDisk } from './precomputed-disk-cache.js';
import { createPromiseLru } from './promise-lru.js';

/**
 * Maximum number of archive IDs to keep cached `SummaryResult`s for.
 * Mirrors the sibling isolated-* / referrer-count cache budget so a
 * long-running viewer session that has opened several archives bounds
 * its memory footprint at a small fixed multiple.
 */
const MAX_ENTRIES = 4;

/**
 * Shared LRU of `getSummary` promises keyed by `archiveId`. The result
 * is a JSON-serialisable object (~hundreds of bytes), so memory cost
 * is negligible.
 */
const lru = createPromiseLru<string, SummaryResult>({ maxEntries: MAX_ENTRIES });

/**
 * Return the (cached) `getSummary` result for an archive, computing it
 * on first request and reusing it on subsequent ones.
 *
 * **Why a process-level cache works here**: `getSummary` is a pure
 * function of the archive's `pages` (and a couple of side tables) at
 * read time. The viewer mode `'archive'` opens the archive read-only
 * and the underlying `db.sqlite` is never written during the viewer
 * session — so a cached snapshot is permanently valid until the
 * archive itself changes (which would mean a new `archiveId`).
 *
 * 10 GB-scale archive measurements: cold first-hit ~26 s (the cost of
 * paging the working set in from disk through SQLite's 64 MiB page
 * cache + libsql's 256 MiB mmap window — I/O bound, not CPU bound),
 * but **every subsequent hit is sub-millisecond** because we never
 * re-enter SQLite at all — the cached object is returned directly.
 *
 * **Stub-mode bypass**: when `context.mode === 'stub'` the viewer is
 * attached to a live `._nitpicker-*` crawl whose writer keeps
 * appending pages and anchors. A cached snapshot would freeze the
 * Summary surface at first hit and disagree with what the live crawl
 * reports. We therefore recompute every request in stub mode (slow
 * but live).
 *
 * On computation failure the rejected promise is removed via the
 * shared LRU's reject-eviction so the next request retries cleanly.
 *
 * Read-only — safe against stub-mode archives.
 * @param context - The viewer's per-request archive context.
 * @returns A promise that resolves to the (cached, except in stub
 *   mode) `SummaryResult`.
 */
export async function getCachedSummary(context: ArchiveContext): Promise<SummaryResult> {
	if (context.mode === 'stub') {
		const accessor = context.manager.get(context.archiveId);
		return getSummary(accessor);
	}
	return lru.getOrLoad(context.archiveId, () => {
		const accessor = context.manager.get(context.archiveId);
		return getOrComputeOnDisk(accessor.tmpDir, 'summary', () => getSummary(accessor));
	});
}
