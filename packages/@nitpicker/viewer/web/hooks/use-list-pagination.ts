import type { PageSize, PaginationMode } from '../types.js';

import { useCurrentPage } from './use-current-page.js';
import { usePageSize } from './use-page-size.js';
import { usePaginationMode } from './use-pagination-mode.js';

/** The aggregate pagination state needed by every list view. */
export interface ListPagination {
	/** The user's pagination-mode preference. */
	mode: PaginationMode;
	/** The user's page-size preference (one of {@link PageSize}). */
	pageSize: PageSize;
	/** The current 1-indexed page from `?page=` (always ≥ 1). */
	currentPage: number;
	/** Sets the current page (writes to `?page=`). */
	setPage: (next: number) => void;
	/**
	 * Sets the page size. The underlying {@link usePageSize} hook writes
	 * `?pageSize=N` to the URL **and** clears `?page=` in the same updater
	 * so the row-coherent invariant survives the size change.
	 */
	setPageSize: (next: PageSize) => void;
}

/**
 * Aggregates the three preference hooks every list view needs so each view
 * call-site has one line instead of three:
 *
 * - {@link usePaginationMode} (mode toggle, persisted in localStorage)
 * - {@link usePageSize} (rows per MPA page, URL-primary with localStorage hint)
 * - {@link useCurrentPage} (URL `?page=` cursor)
 *
 * Page-size changes reset the cursor to page 1 — that responsibility is
 * owned by {@link usePageSize.setPageSize} (single URL update, no race) so
 * this hook is now a flat composition.
 * @returns The aggregate pagination state plus setters.
 */
export function useListPagination(): ListPagination {
	const { mode } = usePaginationMode();
	const { pageSize, setPageSize } = usePageSize();
	const { currentPage, setPage } = useCurrentPage();
	return { mode, pageSize, currentPage, setPage, setPageSize };
}
