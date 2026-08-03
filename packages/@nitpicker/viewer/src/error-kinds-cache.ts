import type { ArchiveContext } from './types.js';
import type {
	ErrorKindEntry,
	ErrorKindsResult,
	GetViewerErrorKindsOptions,
} from '@nitpicker/query';

import {
	getErrorKinds,
	getErrorKindsFastPath,
	matchesAnyFilterValue,
	resolveErrorKindsSort,
	resolveLiveFilterValue,
	sortArrayItems,
} from '@nitpicker/query';

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

/** Per-field value accessors {@link sortArrayItems} needs for `ErrorKindEntry`. */
const SORT_FIELD_CONFIG = {
	host: { getValue: (item: ErrorKindEntry) => item.host },
	kind: { getValue: (item: ErrorKindEntry) => item.kind },
	count: { getValue: (item: ErrorKindEntry) => item.count },
};

/**
 * Sorts `items` by `sortBy`/`sortOrder`, tie-breaking every ordering with
 * `host` then `kind` ascending — the same tie-break `getViewerErrorKinds`
 * applies in SQL (`ORDER BY <col>, host, kind`), reproduced here via stable
 * sort composition (`Array.prototype.toSorted` is spec-guaranteed stable):
 * pre-sorting by the tie-break keys first means the final pass's ties keep
 * that relative order. Without this, {@link applyErrorKindsOptions} would
 * leave same-`sortBy`-value rows in whatever order the cached snapshot
 * happened to hold them, which can visibly differ from what the SQL fast
 * path returns for the identical request.
 * @param items - The rows to sort.
 * @param sortBy - The validated primary sort field.
 * @param sortOrder - The primary sort direction.
 * @returns A new, sorted array.
 */
function sortErrorKindEntries(
	items: ErrorKindEntry[],
	sortBy: 'host' | 'kind' | 'count',
	sortOrder: 'asc' | 'desc',
): ErrorKindEntry[] {
	let sorted = sortArrayItems(items, 'kind', 'asc', SORT_FIELD_CONFIG);
	sorted = sortArrayItems(sorted, 'host', 'asc', SORT_FIELD_CONFIG);
	return sortArrayItems(sorted, sortBy, sortOrder, SORT_FIELD_CONFIG);
}

/**
 * Applies `host`/`kind`/`attribution` filtering (`kind`/`attribution` each
 * accepting a single value or an array OR'd together via
 * {@link matchesAnyFilterValue}), `sortBy`/`sortOrder` sorting, and
 * `limit`/`offset` pagination to an already-computed, unfiltered
 * `ErrorKindsResult` — mirrors `getErrorKinds`'s own options contract (see
 * that function's docs) in plain JS, so `getCachedErrorKinds` can serve any
 * request's parameters from one cached "whole archive" snapshot without
 * re-running the expensive classify-and-aggregate pass per request.
 * `sortBy`/`sortOrder` are resolved via the same `resolveErrorKindsSort`
 * `getErrorKinds` and `getViewerErrorKinds` use, so an out-of-range `sortBy`
 * can't silently pick the wrong default direction here either.
 * @param full - The unfiltered result (computed with `options: {}`) to slice.
 * @param options - The caller's actual filter/sort/pagination options.
 * @returns The filtered/sorted/paginated result. `facets` is copied through
 *   unchanged — it is archive-wide and unaffected by `host`/`kind`/`attribution` filters.
 */
function applyErrorKindsOptions(
	full: ErrorKindsResult,
	options: GetViewerErrorKindsOptions,
): ErrorKindsResult {
	let items = full.items;
	if (options.host) {
		items = items.filter((item) => item.host === options.host);
	}
	items = items.filter((item) => matchesAnyFilterValue(item.kind, options.kind));
	items = items.filter((item) =>
		matchesAnyFilterValue(item.attribution, options.attribution),
	);

	const { sortBy, sortOrder } = resolveErrorKindsSort(options);
	items = sortErrorKindEntries(items, sortBy, sortOrder);

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
 * active crawl. `getErrorKinds` still filters `kind`/`attribution` by single-
 * value equality, so a multi-select `options.kind`/`options.attribution`
 * array is narrowed to its first element via `resolveLiveFilterValue`
 * before being passed through — multi-select degrades to single-select
 * during an active crawl rather than matching nothing.
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
	options: GetViewerErrorKindsOptions = {},
): Promise<ErrorKindsResult> {
	if (context.mode === 'stub') {
		const accessor = context.manager.get(context.archiveId);
		return getErrorKinds(accessor, {
			...options,
			kind: resolveLiveFilterValue(options.kind),
			attribution: resolveLiveFilterValue(options.attribution),
		});
	}
	const full = await lru.getOrLoad(context.archiveId, () => {
		const accessor = context.manager.get(context.archiveId);
		return getOrComputeOnDisk(accessor.tmpDir, 'error-kinds', () =>
			getErrorKindsFastPath(accessor, {}),
		);
	});
	return applyErrorKindsOptions(full, options);
}
