import type { ArchiveContext } from './types.js';
import type { ErrorKindsResult } from '@nitpicker/query';

import { getErrorKinds, getErrorKindsFastPath } from '@nitpicker/query';

import { getOrComputeOnDisk } from './precomputed-disk-cache.js';
import { createPromiseLru } from './promise-lru.js';

/**
 * Maximum number of archive IDs to keep cached `ErrorKindsResult`s for.
 * Mirrors `summary-cache.ts`'s budget so a long-running viewer session
 * that has opened several archives bounds its memory footprint at a small
 * fixed multiple.
 */
const MAX_ENTRIES = 4;

/**
 * Shared LRU of `getErrorKindsFastPath` promises keyed by `archiveId`. The
 * result is a JSON-serialisable object (bounded by at most 50 sample URLs
 * per kind), so memory cost is negligible.
 */
const lru = createPromiseLru<string, ErrorKindsResult>({ maxEntries: MAX_ENTRIES });

/**
 * Return the (cached) `getErrorKindsFastPath` result for an archive,
 * computing it on first request and reusing it on subsequent ones.
 *
 * Same "safe to cache" reasoning as `getCachedSummary`: the viewer opens
 * `'archive'`-mode archives read-only and the underlying `db.sqlite` is
 * never written during the viewer session, so a cached snapshot stays
 * valid until the archive itself changes (a new `archiveId`).
 *
 * **Stub-mode bypass**: same rationale as `getCachedSummary` — a stub's
 * `tmpDir` can be the same directory a prior, already-completed crawl built
 * a `viewer_error_kind_*` read model into (`crawl --resume` / `--append` /
 * `--retry-failed` reopen that tmpDir as a stub while adding pages), and
 * `isViewerReadModelCurrent` only checks the schema version, not recency.
 * Recomputing every request via `getErrorKinds` directly (never
 * `getErrorKindsFastPath`) keeps the Errors view live during an active crawl.
 *
 * On computation failure the rejected promise is removed via the shared
 * LRU's reject-eviction so the next request retries cleanly.
 *
 * Read-only — safe against stub-mode archives.
 * @param context - The viewer's per-request archive context.
 * @returns A promise that resolves to the (cached, except in stub mode)
 *   `ErrorKindsResult`.
 */
export async function getCachedErrorKinds(
	context: ArchiveContext,
): Promise<ErrorKindsResult> {
	if (context.mode === 'stub') {
		const accessor = context.manager.get(context.archiveId);
		return getErrorKinds(accessor);
	}
	return lru.getOrLoad(context.archiveId, () => {
		const accessor = context.manager.get(context.archiveId);
		return getOrComputeOnDisk(accessor.tmpDir, 'error-kinds', () =>
			getErrorKindsFastPath(accessor),
		);
	});
}
