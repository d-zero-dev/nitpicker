import type { PageSize, PaginationMode } from '../types.js';

import { useCallback } from 'react';

import { useCurrentPage } from './use-current-page.js';
import { usePageSize } from './use-page-size.js';
import { usePaginationMode } from './use-pagination-mode.js';

/** The aggregate pagination state needed by every list view. */
export interface ListPagination {
	/** The user's pagination-mode preference. */
	mode: PaginationMode;
	/** The user's page-size preference (`50` / `100` / `200`). */
	pageSize: PageSize;
	/** The current 1-indexed page from `?page=` (always ≥ 1). */
	currentPage: number;
	/** Sets the current page (writes to `?page=`). */
	setPage: (next: number) => void;
	/** Sets the page size and rewinds to page 1 to keep the offset coherent. */
	setPageSize: (next: PageSize) => void;
}

/**
 * Aggregates the three preference hooks every list view needs so each view
 * call-site has one line instead of three:
 *
 * - {@link usePaginationMode} (mode toggle, persisted)
 * - {@link usePageSize} (rows per MPA page, persisted)
 * - {@link useCurrentPage} (URL `?page=` cursor)
 *
 * Changing the page size also resets the page to 1 — otherwise the old
 * offset stays applied to a wider window and the user can land on an
 * out-of-range page (e.g. page 50 of 100 becomes page 50 of 50 with no rows
 * visible).
 * @returns The aggregate pagination state plus setters.
 */
export function useListPagination(): ListPagination {
	const { mode } = usePaginationMode();
	const { pageSize, setPageSize: setPageSizeRaw } = usePageSize();
	const { currentPage, setPage } = useCurrentPage();
	const setPageSize = useCallback(
		(next: PageSize) => {
			setPageSizeRaw(next);
			setPage(1);
		},
		[setPageSizeRaw, setPage],
	);
	return { mode, pageSize, currentPage, setPage, setPageSize };
}
