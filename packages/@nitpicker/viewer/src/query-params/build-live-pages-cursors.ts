/** Inputs needed to compute the live path's pagination cursors. */
export interface LivePagesCursorInput {
	/** The row offset this page was read from. */
	offset: number;
	/** How many items this page actually returned. */
	itemCount: number;
	/** Total matching rows across all pages. */
	total: number;
	/** The page size used for this read. */
	limit: number;
}

/** `nextCursor`/`prevCursor` for one live-path page. */
export interface LivePagesCursors {
	/** Offset-string cursor for the next page, or `null` if this is the last page. */
	nextCursor: string | null;
	/** Offset-string cursor for the previous page, or `null` if this is the first page. */
	prevCursor: string | null;
}

/**
 * Computes `nextCursor`/`prevCursor` for `/api/pages`'s live (offset-based)
 * fallback path, so infinite-scroll pagination keeps working even when a
 * request can't use the `viewer_pages` fast path (a `urlPattern`/`directory`
 * filter, or a missing/stale read model).
 *
 * `listPages` only understands `offset`/`limit`, not the `viewer_pages` fast
 * path's opaque keyset cursors — encoding the *next offset* as a plain
 * decimal string cursor lets `usePagesInfinite`'s `nextCursor`-only
 * continuation logic keep working transparently across both backends
 * (see `parseLivePagesCursor` for the inverse).
 * @param input - The current page's read parameters and result shape.
 * @returns The next/previous cursors for this page.
 */
export function buildLivePagesCursors(input: LivePagesCursorInput): LivePagesCursors {
	const { offset, itemCount, total, limit } = input;
	const nextOffset = offset + itemCount;
	const nextCursor = itemCount > 0 && nextOffset < total ? String(nextOffset) : null;
	const prevCursor = offset > 0 ? String(Math.max(0, offset - limit)) : null;
	return { nextCursor, prevCursor };
}
