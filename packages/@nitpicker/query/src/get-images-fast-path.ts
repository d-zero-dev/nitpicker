import type {
	CursorPaginatedImageList,
	GetImagesFastPathOptions,
	ListImagesOptions,
	ListViewerImagesOptions,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { isImagesFastPathSortBy } from './is-images-fast-path-sort-by.js';
import { listImages } from './list-images.js';
import { listViewerImages } from './list-viewer-images.js';
import { resolveLiveFilterValue } from './resolve-live-filter-value.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches to `listViewerImages` (the `viewer_images` read-model fast
 * path, issue #113) when the read model is current AND the request uses
 * none of the filters/sorts only the wide `images` table can evaluate — the
 * LIKE-based `urlPattern` (matched against `images.src`, a large text
 * column the read model never duplicates) or a `sortBy` of `src`/`alt`
 * (same reason). Falls back to `listImages` (the live, offset-only,
 * write-model path) otherwise.
 *
 * Unlike `listResources`/`listViewerResources` (which currently have no
 * shared fast-path dispatcher — CLI/MCP call `listResources` directly), this
 * helper is the single entry point used by every `/api/images` consumer:
 * the CLI `query images` sub-command, the MCP `list_images` tool, AND the
 * Hono viewer route all call this function instead of duplicating the
 * dispatch decision three times.
 *
 * Returns `CursorPaginatedImageList` (a superset of `listImages`'s
 * `PaginatedImageList`) regardless of which backend answered: the live
 * branch has no keyset cursor to offer, so `nextCursor`/`prevCursor` are
 * always `null` there. CLI/MCP callers that only care about
 * `items`/`total`/`offset`/`limit` can ignore the extra fields; the viewer
 * route uses them when the fast path is live.
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options — the full
 *   `listImages` surface (with `missingAlt`/`missingDimensions` widened to
 *   accept an array, see {@link GetImagesFastPathOptions}), including
 *   `urlPattern` and `src`/`alt` sorts that force the live fallback.
 * @param precheckedReadModelCurrent - The caller's own already-computed
 *   `isViewerReadModelCurrent` result, when it has one (viewer routes check
 *   it first for their stale-refusal gate) — passing it avoids probing the
 *   same tables a second time per request. Omit to let this function check.
 * @returns The image list, from whichever backend is currently valid.
 * @example
 * // Callers never need to check isViewerReadModelCurrent themselves:
 * const images = await getImagesFastPath(accessor, { missingAlt: true });
 */
export async function getImagesFastPath(
	accessor: ArchiveAccessor,
	options: GetImagesFastPathOptions = {},
	precheckedReadModelCurrent?: boolean,
): Promise<CursorPaginatedImageList> {
	const usesWideTableOnlyFilter =
		options.urlPattern != null ||
		(options.sortBy != null && !isImagesFastPathSortBy(options.sortBy));

	if (
		!usesWideTableOnlyFilter &&
		(precheckedReadModelCurrent ?? (await isViewerReadModelCurrent(accessor)))
	) {
		const viewerOptions: ListViewerImagesOptions = {
			missingAlt: options.missingAlt,
			missingDimensions: options.missingDimensions,
			oversizedThreshold: options.oversizedThreshold,
			sortBy: options.sortBy as ListViewerImagesOptions['sortBy'],
			sortOrder: options.sortOrder,
			limit: options.limit,
			offset: options.offset,
			cursor: options.cursor,
			direction: options.direction,
		};
		return listViewerImages(accessor, viewerOptions);
	}

	// The live `listImages` path has no OR concept — an array collapses to
	// its first element (see `resolveLiveFilterValue`'s docs).
	const liveOptions: ListImagesOptions = {
		...options,
		missingAlt: resolveLiveFilterValue(options.missingAlt),
		missingDimensions: resolveLiveFilterValue(options.missingDimensions),
	};
	const liveResult = await listImages(accessor, liveOptions);
	return { ...liveResult, nextCursor: null, prevCursor: null };
}
