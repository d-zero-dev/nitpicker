import type {
	CursorPaginatedDuplicateGroupList,
	GetDuplicatesFastPathOptions,
	ViewerDuplicateGroupEntry,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { countDuplicateGroups } from './count-duplicate-groups.js';
import { findDuplicates } from './find-duplicates.js';
import { listViewerDuplicateGroups } from './list-viewer-duplicate-groups.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/** Default inline page-URL sample size per group, mirrored from `listViewerDuplicateGroups`. */
const DEFAULT_PAGES_LIMIT = 20;

/** Default duplicate-group limit, mirrored from `findDuplicates`. */
const DEFAULT_LIMIT = 50;

/**
 * Dispatches to `listViewerDuplicateGroups` (the `viewer_duplicate_groups`
 * read-model fast path, issue #115) when the read model is current, falling
 * back to `findDuplicates`/`countDuplicateGroups` (the live, write-model
 * path) otherwise. Unlike `getHeaderChecksFastPath`/`getImagesFastPath`,
 * there is no filter/sort combination that forces a live fallback even
 * when the read model IS current: `findDuplicates` has no `sortBy`/
 * `urlPattern` concept to diverge from `viewer_duplicate_groups`'s single
 * supported order, so the read model is always preferred once it exists.
 *
 * `limit` is resolved to {@link DEFAULT_LIMIT} once, up front, and passed
 * explicitly to both branches — passing `options.limit` (possibly
 * `undefined`) straight through to `listViewerDuplicateGroups` would let
 * that function's own, different default (100) leak through on the fast
 * path, changing the visible result-set size for the exact same call based
 * on invisible read-model freshness.
 *
 * This is the single entry point every `findDuplicates` consumer uses
 * instead of duplicating the dispatch decision: the CLI `query duplicates`
 * sub-command, the MCP `find_duplicates` tool, and the Hono
 * `/api/duplicates` viewer route.
 *
 * Returns `CursorPaginatedDuplicateGroupList` regardless of which backend
 * answered: the live branch has no keyset cursor to offer, so
 * `nextCursor`/`prevCursor` are always `null` there. Its `groupId` is a
 * negative sentinel (`-(index + 1)`), never a positive
 * `viewer_duplicate_groups.group_id` — `findDuplicates`/`DuplicateEntry`
 * carries no durable group identity to reuse, and a positive synthetic id
 * could collide with a real, persisted `group_id` if the read model finishes
 * building between this call and a follow-up
 * `listViewerDuplicateGroupPages`/`/api/duplicates/:groupId/pages` call,
 * silently returning an unrelated group's pages. Callers must treat a
 * non-positive `groupId` as "no drill-down available" — which is harmless
 * here because the live branch's `pages` is never truncated (see below),
 * so there is nothing left to page through anyway.
 * @param accessor - The archive accessor to query.
 * @param options - Filter and pagination options.
 * @returns The duplicate-group list, from whichever backend is currently valid.
 * @example
 * // Callers never need to check isViewerReadModelCurrent themselves:
 * const duplicates = await getDuplicatesFastPath(accessor, { field: 'description' });
 */
export async function getDuplicatesFastPath(
	accessor: ArchiveAccessor,
	options: GetDuplicatesFastPathOptions = {},
): Promise<CursorPaginatedDuplicateGroupList> {
	const field = options.field ?? 'title';
	const pagesLimit = options.pagesLimit ?? DEFAULT_PAGES_LIMIT;
	const limit = options.limit ?? DEFAULT_LIMIT;

	if (await isViewerReadModelCurrent(accessor)) {
		return listViewerDuplicateGroups(accessor, {
			field,
			pagesLimit,
			limit,
			cursor: options.cursor,
			direction: options.direction,
			offset: options.offset,
		});
	}

	const offset = options.offset ?? 0;
	const [entries, total] = await Promise.all([
		findDuplicates(accessor, field, limit, offset),
		countDuplicateGroups(accessor, field),
	]);
	// No `.slice(0, pagesLimit)` truncation: `findDuplicates` already returns
	// every member URL (it has no pagination of its own), so there is no
	// remainder for a drill-down call to fetch — truncating here would hide
	// data with no way to retrieve it back, since this branch's `groupId` is
	// a non-positive sentinel that `/api/duplicates/:groupId/pages` rejects
	// (see this function's docs).
	const items: ViewerDuplicateGroupEntry[] = entries.map((entry, index) => ({
		groupId: -(index + 1),
		field,
		value: entry.value,
		count: entry.count,
		pages: entry.urls,
	}));
	return {
		items,
		total,
		limit,
		offset,
		nextCursor: null,
		prevCursor: null,
	};
}
