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
 * read-model fast path, issue #119) whenever the read model is current. No
 * filter or sort forces the live fallback: every `sortBy` value —
 * `'url'` (natural numeric-aware sort via `natural_url_rank`), the four
 * header-flag keys (their boolean columns directly), and unset (BINARY
 * `url_sort_key`) — maps onto a read-model column. See
 * `HeaderChecksEffectiveSortBy` for why the unset-vs-`'url'` split is kept
 * distinct rather than collapsed (`checkHeaders` treats an explicit
 * `sortBy: 'url'` as natural sort, distinct from its unset-`sortBy` BINARY
 * default — both orders are individually representable, so neither forces
 * live).
 *
 * This is the single entry point every `checkHeaders` consumer uses instead
 * of duplicating the dispatch decision: the CLI `query headers` sub-command,
 * the MCP `check_headers` tool, and the Hono `/api/headers` viewer route.
 *
 * Returns `CursorPaginatedHeaderCheckList` (a superset of `checkHeaders`'s
 * `PaginatedHeaderCheckList`) regardless of which backend answered: the
 * live branch has no keyset cursor to offer, so `nextCursor`/`prevCursor`
 * are always `null` there.
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options — the full
 *   `checkHeaders` surface.
 * @param precheckedReadModelCurrent - The caller's own already-computed
 *   `isViewerReadModelCurrent` result, when it has one (viewer routes check
 *   it first for their stale-refusal gate) — passing it avoids probing the
 *   same tables a second time per request. Omit to let this function check.
 * @returns The header-check list, from whichever backend is currently valid.
 * @example
 * // Callers never need to check isViewerReadModelCurrent themselves:
 * const headers = await getHeaderChecksFastPath(accessor, { missingOnly: true });
 */
export async function getHeaderChecksFastPath(
	accessor: ArchiveAccessor,
	options: CheckHeadersOptions = {},
	precheckedReadModelCurrent?: boolean,
): Promise<CursorPaginatedHeaderCheckList> {
	if (precheckedReadModelCurrent ?? (await isViewerReadModelCurrent(accessor))) {
		const viewerOptions: ListViewerHeaderChecksOptions = {
			missingOnly: options.missingOnly,
			hasCSP: options.hasCSP,
			hasXFrameOptions: options.hasXFrameOptions,
			hasXContentTypeOptions: options.hasXContentTypeOptions,
			hasHSTS: options.hasHSTS,
			sortBy: options.sortBy,
			sortOrder: options.sortOrder,
			limit: options.limit,
			offset: options.offset,
			cursor: options.cursor,
			direction: options.direction,
		};
		return listViewerHeaderChecks(accessor, viewerOptions);
	}

	const liveResult = await checkHeaders(accessor, options);
	return { ...liveResult, nextCursor: null, prevCursor: null };
}
