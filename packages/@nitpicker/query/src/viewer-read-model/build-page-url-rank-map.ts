/** Minimal shape `buildPageUrlRankMap` needs from each listable `pages` row. */
export interface PageUrlRankSourceRow {
	/** `pages.id`. */
	id: number;
	/** The page's absolute URL — the same value stored as `viewer_pages.url_sort_key`. */
	url: string;
}

/**
 * Builds a `page_id → page_url_rank` map: a dense, zero-based integer
 * ranking of every listable page in the exact same order
 * `viewer_pages.url_sort_key` sorts to (URL ascending, `page_id` as
 * tie-breaker).
 *
 * `viewer_images` needs a page-order sort key for its default `/api/images`
 * sort, but must NOT inline the page URL text itself: at `viewer_images`'s
 * ~9.11M-row scale, duplicating the URL string onto every image row would
 * dominate the read model's storage (every other
 * read-model table that inlines a `url_sort_key` — `viewer_pages`,
 * `viewer_resources`, `viewer_anchor_facts`, `viewer_directory_pages` — sits
 * at a much smaller row count, one row per page/resource/edge rather than
 * one row per image). A small integer surrogate (4 bytes) copied onto every
 * image row costs a fraction of what the full URL string (60-150+ bytes)
 * would, while still letting `viewer_images` keep the same flat,
 * single-index, no-join keyset-pagination shape every other table uses —
 * unlike a join-per-query against `viewer_pages` at read time.
 *
 * Callers pass the SAME `sourceRows` array already loaded for
 * `viewer_pages` (see `build-viewer-read-model.ts`) — the archive's total
 * page count (hundreds of thousands at real-world scale) is small enough to
 * sort in memory, unlike the images table it ultimately annotates.
 * @param sourceRows - Every listable `pages` row (the same set that
 *   populates `viewer_pages`).
 * @returns A map from `pages.id` to its dense rank in URL-ascending order.
 */
export function buildPageUrlRankMap(
	sourceRows: readonly PageUrlRankSourceRow[],
): Map<number, number> {
	const sorted = sourceRows.toSorted((a, b) => {
		const comparison = compareUrlBinary(a.url, b.url);
		return comparison === 0 ? a.id - b.id : comparison;
	});
	const rankByPageId = new Map<number, number>();
	for (const [rank, row] of sorted.entries()) {
		rankByPageId.set(row.id, rank);
	}
	return rankByPageId;
}

/**
 * Compares two URLs the same way SQLite's default `BINARY` collation orders
 * `viewer_pages.url_sort_key` — byte-wise over the UTF-8 encoding, not JS's
 * native UTF-16 code-unit comparison (`<`/`>` on `string`). The two diverge
 * for URLs containing supplementary-plane characters (code points ≥
 * U+10000, stored as UTF-16 surrogate pairs but as 4 contiguous bytes ≥ 0xF0
 * in UTF-8): a plain `<`/`>` comparison would rank such a page differently
 * from where `ORDER BY url_sort_key` (and thus `listPages`/`viewer_pages`)
 * ranks the same page, silently diverging `/api/images`'s default page-order
 * sort from the Pages view's URL order for affected archives.
 *
 * Compares code points, which orders strings exactly as their UTF-8 bytes
 * do (UTF-8 preserves code point order, and a string that is a prefix of
 * another sorts first either way), without encoding either string. Why not
 * `Buffer.compare(Buffer.from(a), Buffer.from(b))`: sorting hundreds of
 * thousands of URLs makes millions of comparisons, and encoding both operands
 * in each one allocates two `Buffer`s per comparison — native memory that is
 * released only when the garbage collector gets to it. A lone surrogate counts
 * as U+FFFD, which is what the UTF-8 encoding writes for it.
 * @param a - The first URL.
 * @param b - The second URL.
 * @returns Negative if `a` sorts first, positive if `b` sorts first, `0` if equal.
 */
function compareUrlBinary(a: string, b: string): number {
	let indexA = 0;
	let indexB = 0;
	while (indexA < a.length && indexB < b.length) {
		const codePointA = scalarValueAt(a, indexA);
		const codePointB = scalarValueAt(b, indexB);
		if (codePointA !== codePointB) {
			return codePointA < codePointB ? -1 : 1;
		}
		// Equal code points have the same width in UTF-16, so both advance together.
		// A code point above U+FFFF (65_535) is a surrogate pair: two code units.
		indexA += codePointA > 65_535 ? 2 : 1;
		indexB += codePointB > 65_535 ? 2 : 1;
	}
	if (indexA < a.length) {
		return 1;
	}
	return indexB < b.length ? -1 : 0;
}

/**
 * The Unicode scalar value at a UTF-16 index, with a lone surrogate mapped to
 * U+FFFD as UTF-8 encoding does.
 * @param text - The string.
 * @param index - A code unit index that starts a code point.
 * @returns The scalar value.
 */
function scalarValueAt(text: string, index: number): number {
	const codePoint = text.codePointAt(index)!;
	// U+D800..U+DFFF (55_296..57_343) are lone surrogates; U+FFFD is 65_533.
	return codePoint >= 55_296 && codePoint <= 57_343 ? 65_533 : codePoint;
}
