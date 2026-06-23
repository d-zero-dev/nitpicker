import { PAGE_QUERY_KEY } from './use-current-page.js';

/**
 * The pure transformation that {@link import('./use-current-page.js').useCurrentPage}
 * applies inside its `setSearchParams` functional updater.
 *
 * `target <= 1` deletes the `?page=` key entirely so the canonical
 * first-page URL stays clean (a fresh `/pages` link should not become
 * `/pages?page=1`). Higher targets are written verbatim — clamping against
 * `totalPages` is the caller's job; this helper does no upper bound check.
 * The input target is assumed to be a finite integer ≥ 1 (the
 * `useCurrentPage` hook already filters `Number.isFinite` + floor + ≥ 1).
 * @param prev - The current URLSearchParams.
 * @param target - The new 1-indexed page.
 * @returns A new URLSearchParams with `?page=` updated.
 */
export function applySetPage(prev: URLSearchParams, target: number): URLSearchParams {
	const next = new URLSearchParams(prev);
	if (target <= 1) {
		next.delete(PAGE_QUERY_KEY);
	} else {
		next.set(PAGE_QUERY_KEY, String(target));
	}
	return next;
}
