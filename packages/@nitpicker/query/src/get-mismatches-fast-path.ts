import type {
	CursorPaginatedMismatchList,
	FindMismatchesFastPathOptions,
	MismatchType,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { findMismatches } from './find-mismatches.js';
import { listViewerMismatches } from './list-viewer-mismatches.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Narrows a possibly-array/possibly-omitted `type` selection down to the
 * single value `findMismatches` (live) accepts as its required positional
 * argument. The live path has no `WHERE type IN (...)` equivalent to fall
 * back to, so a multi-select — or "every type" (`undefined`/`[]`) — request
 * that lands here (read model absent/stale, or `usesWideTableOnlyFilter`)
 * degrades to the same single default type the UI's radio-button predecessor
 * always sent, rather than throwing or guessing which of several types to
 * scan for.
 * @param type - The caller's `type` selection.
 * @returns The single type to pass to `findMismatches`.
 */
function resolveLiveMismatchType(
	type: MismatchType | MismatchType[] | undefined,
): MismatchType {
	if (type == null) return 'canonical';
	const values = Array.isArray(type) ? type : [type];
	return values.length === 1 ? values[0]! : 'canonical';
}

/**
 * Dispatches to `listViewerMismatches` (the `viewer_mismatches` read-model
 * fast path, issue #115) whenever the read model is current. No filter or
 * sort forces the live fallback: `urlPattern` is a plain LIKE
 * against the inlined `url_sort_key` (identical semantics to the live
 * path's `ur.url LIKE` — neither side resolves redirect/alias equivalents,
 * see `ListViewerMismatchesOptions.urlPattern`), and every `sortBy` value
 * (`'url'` natural sort via `natural_url_rank`, `'actual'`/`'expected'`
 * directly, unset = BINARY `url_sort_key`) maps onto a read-model column —
 * see `MismatchesEffectiveSortBy` for why the unset-vs-`'url'` split is kept
 * distinct rather than collapsed.
 *
 * This is the single entry point every `findMismatches` consumer uses
 * instead of duplicating the dispatch decision: the CLI `query mismatches`
 * sub-command, the MCP `find_mismatches` tool, and the Hono
 * `/api/mismatches` viewer route.
 *
 * Returns `CursorPaginatedMismatchList` (a superset of `findMismatches`'s
 * paged-mode result) regardless of which backend answered: the live branch
 * has no keyset cursor to offer, so `nextCursor`/`prevCursor` are always
 * `null` there.
 * @param accessor - The archive accessor to query.
 * @param type - Which mismatch comparison(s) to list — a single value, an
 *   array (OR'd together, fast path only), or `undefined` for every type.
 *   A multi-value/`undefined` selection that falls back to the live path
 *   (read model stale/absent) is narrowed to a single type first — see
 *   {@link resolveLiveMismatchType}.
 * @param options - Filter, sort, and pagination options — the full
 *   `findMismatches` surface.
 * @param precheckedReadModelCurrent - The caller's own already-computed
 *   `isViewerReadModelCurrent` result, when it has one (viewer routes check
 *   it first for their stale-refusal gate) — passing it avoids probing the
 *   same tables a second time per request. Omit to let this function check.
 * @returns The mismatch list, from whichever backend is currently valid.
 * @example
 * // Callers never need to check isViewerReadModelCurrent themselves:
 * const mismatches = await getMismatchesFastPath(accessor, 'canonical', { limit: 100 });
 */
export async function getMismatchesFastPath(
	accessor: ArchiveAccessor,
	type: MismatchType | MismatchType[] | undefined,
	options: FindMismatchesFastPathOptions = {},
	precheckedReadModelCurrent?: boolean,
): Promise<CursorPaginatedMismatchList> {
	if (precheckedReadModelCurrent ?? (await isViewerReadModelCurrent(accessor))) {
		return listViewerMismatches(accessor, {
			type,
			urlPattern: options.urlPattern,
			sortBy: options.sortBy,
			sortOrder: options.sortOrder,
			limit: options.limit,
			cursor: options.cursor,
			direction: options.direction,
			offset: options.offset,
		});
	}

	const liveResult = await findMismatches(accessor, resolveLiveMismatchType(type), {
		limit: options.limit,
		offset: options.offset,
		urlPattern: options.urlPattern,
		sortBy: options.sortBy,
		sortOrder: options.sortOrder,
		onSortProgress: options.onSortProgress,
	});
	return { ...liveResult, nextCursor: null, prevCursor: null };
}
