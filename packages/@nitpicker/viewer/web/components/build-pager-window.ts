/** A token in the pager's rendered button strip. */
export type PagerToken = number | 'ellipsis-start' | 'ellipsis-end';

/**
 * Builds the compact "1 … 4 5 *6* 7 8 … 42" window of page numbers for the
 * {@link import('./pager.js').Pager} button row.
 *
 * The current page is always shown, together with `siblings` neighbours on
 * each side and the first/last page. Ellipsis tokens are inserted where the
 * window would otherwise jump (more than one number) — collapsing them when
 * they would only hide a single page (because rendering "1 … 2 3 …" is
 * worse than "1 2 3 …"). The output never repeats a page number and is
 * monotonically increasing.
 * @param totalPages - The total number of pages (`>= 1`).
 * @param currentPage - The active 1-indexed page.
 * @param siblings - Numbers to show on each side of `currentPage`. Defaults to 1.
 * @returns The ordered list of tokens to render.
 */
export function buildPagerWindow(
	totalPages: number,
	currentPage: number,
	siblings: number = 1,
): PagerToken[] {
	const pages = Math.max(1, Math.floor(totalPages));
	const current = Math.min(pages, Math.max(1, Math.floor(currentPage)));
	const span = Math.max(0, Math.floor(siblings));

	const start = Math.max(2, current - span);
	const end = Math.min(pages - 1, current + span);

	const tokens: PagerToken[] = [1];
	// Bridge the leading gap: when only page 2 is hidden (start === 3) emit
	// it directly — an ellipsis here would hide exactly one number, defeating
	// the strip's purpose. When `start === 2` the loop emits 2 itself. Only
	// emit a leading ellipsis when there are ≥ 2 hidden pages (start > 3).
	if (start === 3) {
		tokens.push(2);
	} else if (start > 3) {
		tokens.push('ellipsis-start');
	}

	for (let p = start; p <= end; p++) {
		tokens.push(p);
	}

	// Symmetric to the leading bridge: when only `pages - 1` is hidden
	// (end === pages - 2) emit it directly; only emit a trailing ellipsis
	// when ≥ 2 pages would be hidden.
	if (end === pages - 2) {
		tokens.push(pages - 1);
	} else if (end < pages - 2) {
		tokens.push('ellipsis-end');
	}
	if (pages >= 2) {
		tokens.push(pages);
	}
	return tokens;
}
