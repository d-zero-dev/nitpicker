import type { ArchiveContext } from './types.js';
import type { ErrorKindsResult, GetErrorKindsOptions } from '@nitpicker/query';

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
 * Shared LRU of unfiltered (`options: {}`) `getErrorKindsFastPath` promises
 * keyed by `archiveId`. Caching the unfiltered snapshot — not the caller's
 * actual request — is what lets one cached value serve every `host`/`kind`/
 * `sortBy`/`sortOrder`/`limit`/`offset` combination (see
 * {@link applyErrorKindsOptions}); the result is a JSON-serialisable object
 * (bounded by at most 50 sample URLs per host×kind pair), so memory cost is
 * negligible.
 */
const lru = createPromiseLru<string, ErrorKindsResult>({ maxEntries: MAX_ENTRIES });

/**
 * Compares two same-typed sort-field values (`host`/`kind` strings or
 * `count` numbers) for {@link applyErrorKindsOptions}'s in-memory re-sort.
 * @param a - The first value.
 * @param b - The second value.
 * @returns Negative/zero/positive per the usual `Array.prototype.sort` contract.
 */
function compareEntryField(a: string | number, b: string | number): number {
	return typeof a === 'number' && typeof b === 'number'
		? a - b
		: String(a).localeCompare(String(b));
}

/**
 * Applies `host`/`kind` filtering, `sortBy`/`sortOrder` sorting, and
 * `limit`/`offset` pagination to an already-computed, unfiltered
 * `ErrorKindsResult` — mirrors `getErrorKinds`'s own options contract (see
 * that function's docs) in plain JS, so `getCachedErrorKinds` can serve any
 * request's parameters from one cached "whole archive" snapshot without
 * re-running the expensive classify-and-aggregate pass per request.
 * @param full - The unfiltered result (computed with `options: {}`) to slice.
 * @param options - The caller's actual filter/sort/pagination options.
 * @returns The filtered/sorted/paginated result. `facets` is copied through
 *   unchanged — it is archive-wide and unaffected by `host`/`kind` filters.
 */
function applyErrorKindsOptions(
	full: ErrorKindsResult,
	options: GetErrorKindsOptions,
): ErrorKindsResult {
	let items = full.items;
	if (options.host) {
		items = items.filter((item) => item.host === options.host);
	}
	if (options.kind) {
		items = items.filter((item) => item.kind === options.kind);
	}

	const sortBy = options.sortBy ?? 'count';
	const sortOrder = options.sortOrder ?? (sortBy === 'count' ? 'desc' : 'asc');
	const direction = sortOrder === 'desc' ? -1 : 1;
	items = items.toSorted((a, b) => compareEntryField(a[sortBy], b[sortBy]) * direction);

	const total = items.length;
	const offset = options.offset ?? 0;
	const limit = options.limit ?? items.length;
	return { items: items.slice(offset, offset + limit), total, facets: full.facets };
}

/**
 * Return the (cached) error-kind breakdown for an archive, computing the
 * unfiltered snapshot on first request and reusing it on subsequent ones —
 * `options` is applied fresh per call via {@link applyErrorKindsOptions}, so
 * different query parameters against the same archive never recompute the
 * classify-and-aggregate pass.
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
 * `getErrorKindsFastPath`, and with the caller's real `options` — no cached
 * snapshot to slice) keeps the Connection Failures view live during an
 * active crawl.
 *
 * On computation failure the rejected promise is removed via the shared
 * LRU's reject-eviction so the next request retries cleanly.
 *
 * Read-only — safe against stub-mode archives.
 * @param context - The viewer's per-request archive context.
 * @param options - Filter, sort, and pagination options for this request.
 * @returns A promise that resolves to the `ErrorKindsResult` matching `options`.
 */
export async function getCachedErrorKinds(
	context: ArchiveContext,
	options: GetErrorKindsOptions = {},
): Promise<ErrorKindsResult> {
	if (context.mode === 'stub') {
		const accessor = context.manager.get(context.archiveId);
		return getErrorKinds(accessor, options);
	}
	const full = await lru.getOrLoad(context.archiveId, () => {
		const accessor = context.manager.get(context.archiveId);
		return getOrComputeOnDisk(accessor.tmpDir, 'error-kinds', () =>
			getErrorKindsFastPath(accessor, {}),
		);
	});
	return applyErrorKindsOptions(full, options);
}
