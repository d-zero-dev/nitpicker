import { computeUrlSortRanks as computeUrlSortRanksNative } from '@nitpicker/core/compute-url-sort-ranks';

/**
 * Ranks URLs in the natural order the viewer lists pages and resources in:
 * numbers inside a path compare by value (`page2` before `page10`), letter
 * case and percent-escapes do not split the order, a directory's own page
 * comes before its index pages and its children, and the host decides before
 * the path.
 *
 * The order is a total order — the same URLs in any input order get the same
 * ranking — and it is persisted (`viewer_pages.natural_url_rank`,
 * `viewer_url_sort_keys`), so a change to its definition needs a read model
 * schema version bump. The definition lives in the native crate
 * (`@nitpicker/core`, `crates/nitpicker_url_key`).
 *
 * Each URL is parsed once, natively. Memory is proportional to the URLs'
 * total length — the UTF-8 bytes handed over plus native keys of roughly the
 * same size again, on top of the caller's own copy of the strings — so a
 * caller with a very large URL set ranks the distinct URLs only.
 * @param urls - The URLs to rank; identical URLs rank in input order.
 * @returns For each input position, the zero-based position that URL takes in
 *   the sorted list — a permutation of `0..urls.length`.
 * @example
 * ```ts
 * computeUrlSortRanks([
 * 	'https://example.com/page10',
 * 	'https://example.com/page2',
 * 	'https://example.com/',
 * ]); // Uint32Array [2, 1, 0]
 * ```
 */
export function computeUrlSortRanks(urls: readonly string[]): Uint32Array {
	return computeUrlSortRanksNative(urls);
}
