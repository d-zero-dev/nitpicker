import type { ArchiveContext } from './types.js';
import type { SummaryResult } from '@nitpicker/query';

import { getSummary, getSummaryFastPath } from '@nitpicker/query';

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
 * Shared LRU of `getSummaryFastPath` promises keyed by `archiveId`. The
 * result is a JSON-serialisable object (~hundreds of bytes), so memory
 * cost is negligible.
 */
const lru = createPromiseLru<string, SummaryResult>({ maxEntries: MAX_ENTRIES });

/**
 * Return the (cached) `getSummaryFastPath` result for an archive, computing
 * it on first request and reusing it on subsequent ones.
 *
 * **Why a process-level cache works here**: `getSummaryFastPath` (whether
 * it reads the precomputed `viewer_summary` read model or falls back to a
 * live `getSummary` aggregation) is a pure function of the archive's
 * `pages` (and a couple of side tables) at read time. The viewer mode
 * `'archive'` opens the archive read-only and the underlying `db.sqlite` is
 * never written during the viewer session — so a cached snapshot is
 * permanently valid until the archive itself changes (which would mean a
 * new `archiveId`).
 *
 * 10 GB-scale archive measurements (live `getSummary` fallback, i.e. no
 * current `viewer_summary` read model): cold first-hit ~26 s (the cost of
 * paging the working set in from disk through SQLite's 64 MiB page
 * cache + libsql's 256 MiB mmap window — I/O bound, not CPU bound), but
 * **every subsequent hit is sub-millisecond** because we never re-enter
 * SQLite at all — the cached object is returned directly. When the read
 * model is current, `getSummaryFastPath` already answers in low
 * milliseconds even on a cold first hit (see
 * `scripts/bench-viewer-summary-read-model.mjs`), so this cache mainly
 * still helps archives whose read model has gone stale.
 *
 * **Stub-mode bypass**: when `context.mode === 'stub'` the viewer is
 * attached to a live `._nitpicker-*` crawl whose writer keeps
 * appending pages and anchors. A cached snapshot would freeze the
 * Summary surface at first hit and disagree with what the live crawl
 * reports. We therefore recompute every request in stub mode (slow
 * but live) by calling `getSummary` directly — **not**
 * `getSummaryFastPath`. A stub's tmpDir can be the same directory a
 * prior, already-completed crawl built a `viewer_summary` read model
 * into (`crawl --resume` / `--append` / `--retry-failed` reopen that
 * same tmpDir as a stub while adding pages); `isViewerReadModelCurrent`
 * only checks the schema version, so it would report that stale,
 * pre-resume snapshot as "current" and `getSummaryFastPath` would
 * happily serve it instead of live numbers.
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
		return getOrComputeOnDisk(
			accessor.tmpDir,
			'summary',
			() => getSummaryFastPath(accessor),
			isCompleteSummaryResult,
		);
	});
}

/**
 * Guards against a disk-cached `summary.json` written by a nitpicker
 * build that predates the exclude-settings fields (issue #261) — the
 * archive's content-hash cache key does not change on a nitpicker
 * version upgrade, so an old-shaped artefact would otherwise be
 * returned as-is and crash `summary-view.tsx`'s `data.excludes.length`
 * read.
 * @param value - A parsed disk-cache hit to validate.
 * @returns Whether `value` has every exclude-settings field the current
 *   `SummaryResult` shape requires.
 */
function isCompleteSummaryResult(value: SummaryResult): boolean {
	return (
		Array.isArray(value.excludes) &&
		Array.isArray(value.excludeKeywords) &&
		Array.isArray(value.excludeUrls) &&
		typeof value.maxExcludedDepth === 'number'
	);
}
