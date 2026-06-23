import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

import { applySetPage } from './apply-set-page.js';
import { parsePageParam } from './parse-page-param.js';

/** The URL query key that encodes the current MPA page (1-indexed). */
export const PAGE_QUERY_KEY = 'page';

/** The shape returned by {@link useCurrentPage}. */
export interface UseCurrentPageResult {
	/** The current page number, always ≥ 1. */
	currentPage: number;
	/** Sets the page in the URL; passing `1` removes the param to keep URLs clean. */
	setPage: (next: number) => void;
}

/**
 * Reads and writes the MPA pagination cursor in the URL (`?page=N`).
 *
 * Page numbers are 1-indexed — the first page is `1`, and `setPage(1)`
 * deletes the param entirely so the canonical first-page URL stays clean.
 * Filter changes (handled by {@link import('./use-url-filter.js').useUrlFilter})
 * reset `?page=` as a side effect. The parse logic itself lives in
 * {@link parsePageParam} so it can be unit-tested without a Router.
 *
 * **Why `setPage` defaults to `replace: true`:** pagination is incremental
 * state, not a new view. An analyst clicking Next twenty times scanning rows
 * should not have to press Back twenty times to leave the page list — the
 * Back stack should take them to the *previous view* (the one they came
 * from), not to page N-1. The Forward / Back arrows still work *within* the
 * pager via Prev / Next buttons. Use `setParams` with the functional updater
 * so `setPage` keeps a stable identity across renders.
 * @returns The current page and a setter.
 */
export function useCurrentPage(): UseCurrentPageResult {
	const [params, setParams] = useSearchParams();
	const currentPage = parsePageParam(params.get(PAGE_QUERY_KEY));
	const setPage = useCallback(
		(next: number) => {
			const target = Number.isFinite(next) && next >= 1 ? Math.floor(next) : 1;
			setParams((prev) => applySetPage(prev, target), { replace: true });
		},
		[setParams],
	);
	return { currentPage, setPage };
}
