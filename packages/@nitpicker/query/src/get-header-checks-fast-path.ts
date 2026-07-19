import type {
	CheckHeadersOptions,
	CursorPaginatedHeaderCheckList,
	ListViewerHeaderChecksOptions,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { checkHeaders } from './check-headers.js';
import { listViewerHeaderChecks } from './list-viewer-header-checks.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches to `listViewerHeaderChecks` (the `viewer_header_checks`
 * read-model fast path, issue #119) when the read model is current AND the
 * request's `sortBy` is unset — the only case `viewer_header_checks`
 * indexes (see `getHeaderChecksSortSpec`). Falls back to `checkHeaders` (the
 * legacy, offset-only, write-model path that scans `pages.responseHeaders`
 * via SQL `LIKE`) for ANY explicit `sortBy`, including `'url'`: `checkHeaders`
 * treats an explicit `sortBy: 'url'` as a request for natural (numeric-aware)
 * URL ordering via `applyListOrder`'s `type: 'url'` branch (`useUrlSort =
 * options.sortBy != null`), whereas `listViewerHeaderChecks` only ever
 * orders by the verbatim-copied `url_sort_key` column under SQLite's plain
 * `BINARY` collation — equivalent to `checkHeaders`'s *unset*-`sortBy`
 * default, not its explicit-`'url'` natural sort. Routing an explicit
 * `sortBy: 'url'` to the fast path would silently swap ordering algorithms
 * depending on read-model freshness, with no error and no visible signal.
 *
 * This is the single entry point every `checkHeaders` consumer uses instead
 * of duplicating the dispatch decision: the CLI `query headers` sub-command,
 * the MCP `check_headers` tool, and the Hono `/api/headers` viewer route.
 *
 * Returns `CursorPaginatedHeaderCheckList` (a superset of `checkHeaders`'s
 * `PaginatedHeaderCheckList`) regardless of which backend answered: the
 * legacy branch has no keyset cursor to offer, so `nextCursor`/`prevCursor`
 * are always `null` there.
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options — the full
 *   `checkHeaders` surface, including any explicit `sortBy` (even `'url'`)
 *   that forces the legacy fallback.
 * @returns The header-check list, from whichever backend is currently valid.
 * @example
 * // Callers never need to check isViewerReadModelCurrent themselves:
 * const headers = await getHeaderChecksFastPath(accessor, { missingOnly: true });
 */
export async function getHeaderChecksFastPath(
	accessor: ArchiveAccessor,
	options: CheckHeadersOptions = {},
): Promise<CursorPaginatedHeaderCheckList> {
	const usesWideTableOnlyFilter = options.sortBy != null;

	if (!usesWideTableOnlyFilter && (await isViewerReadModelCurrent(accessor))) {
		const viewerOptions: ListViewerHeaderChecksOptions = {
			missingOnly: options.missingOnly,
			hasCSP: options.hasCSP,
			hasXFrameOptions: options.hasXFrameOptions,
			hasXContentTypeOptions: options.hasXContentTypeOptions,
			hasHSTS: options.hasHSTS,
			sortOrder: options.sortOrder,
			limit: options.limit,
			offset: options.offset,
			cursor: options.cursor,
			direction: options.direction,
		};
		return listViewerHeaderChecks(accessor, viewerOptions);
	}

	const legacyResult = await checkHeaders(accessor, options);
	return { ...legacyResult, nextCursor: null, prevCursor: null };
}
