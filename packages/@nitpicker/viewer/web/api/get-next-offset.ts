import { PAGE_SIZE } from './page-size.js';

/** The minimal paginated shape needed to compute the next offset. */
interface PaginatedLike {
	/** Rows in this page (only the count is used). */
	items: unknown[];
	/** Total matching rows on the server. */
	total: number;
}

/**
 * Computes the next `offset` page param for an infinite query, or `undefined`
 * when all rows are loaded. O(1) — derives the next offset from the previous
 * page param rather than re-summing every loaded page.
 * @param lastPage - The most recently fetched page (for its `total`).
 * @param lastPageParam - The offset used for the last fetch.
 * @returns The next offset, or `undefined` if there are no more rows.
 */
export function getNextOffset(
	lastPage: PaginatedLike,
	lastPageParam: number,
): number | undefined {
	const next = lastPageParam + PAGE_SIZE;
	return next < lastPage.total ? next : undefined;
}
