import type {
	CursorPaginatedMismatchList,
	FindMismatchesFastPathOptions,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { findMismatches } from './find-mismatches.js';
import { listViewerMismatches } from './list-viewer-mismatches.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches to `listViewerMismatches` (the `viewer_mismatches` read-model
 * fast path, issue #115) when the read model is current AND the request
 * uses none of the filters/sorts only the wide `pages` table can evaluate —
 * the LIKE-based `urlPattern` (matched against `pages.url`, a column the
 * read model duplicates as `url_sort_key` but never LIKE-indexes) or ANY
 * explicit `sortBy` (including `'url'`, mirroring `getHeaderChecksFastPath`'s
 * own `'url'`-forces-legacy rule): `viewer_mismatches` only indexes `(type,
 * url_sort_key, mismatch_id)` (see `vm_type_url`'s docs), so a request for
 * `sortBy: 'actual' | 'expected'` — or an explicit natural-sort `'url'`
 * request the legacy path's `applyListOrder` treats differently from its own
 * unset-`sortBy` default — falls back to `findMismatches` (the legacy,
 * offset-only, write-model path) instead.
 *
 * This is the single entry point every `findMismatches` consumer uses
 * instead of duplicating the dispatch decision: the CLI `query mismatches`
 * sub-command, the MCP `find_mismatches` tool, and the Hono
 * `/api/mismatches` viewer route.
 *
 * Returns `CursorPaginatedMismatchList` (a superset of `findMismatches`'s
 * paged-mode result) regardless of which backend answered: the legacy branch
 * has no keyset cursor to offer, so `nextCursor`/`prevCursor` are always
 * `null` there.
 * @param accessor - The archive accessor to query.
 * @param type - Which mismatch comparison to list.
 * @param options - Filter, sort, and pagination options — the full
 *   `findMismatches` surface, including any explicit `sortBy`/`urlPattern`
 *   that forces the legacy fallback.
 * @returns The mismatch list, from whichever backend is currently valid.
 * @example
 * // Callers never need to check isViewerReadModelCurrent themselves:
 * const mismatches = await getMismatchesFastPath(accessor, 'canonical', { limit: 100 });
 */
export async function getMismatchesFastPath(
	accessor: ArchiveAccessor,
	type: 'canonical' | 'og:title' | 'og:description',
	options: FindMismatchesFastPathOptions = {},
): Promise<CursorPaginatedMismatchList> {
	const usesWideTableOnlyFilter = options.sortBy != null || options.urlPattern != null;

	if (!usesWideTableOnlyFilter && (await isViewerReadModelCurrent(accessor))) {
		return listViewerMismatches(accessor, {
			type,
			sortOrder: options.sortOrder,
			limit: options.limit,
			cursor: options.cursor,
			direction: options.direction,
			offset: options.offset,
		});
	}

	const legacyResult = await findMismatches(accessor, type, {
		limit: options.limit,
		offset: options.offset,
		urlPattern: options.urlPattern,
		sortBy: options.sortBy,
		sortOrder: options.sortOrder,
	});
	return { ...legacyResult, nextCursor: null, prevCursor: null };
}
