/**
 * Locale-aware natural URL collator used by {@link sortResourcesByUrl}.
 *
 * - `numeric: true` makes embedded numbers compare by value, so
 *   `image-2.jpg` sorts before `image-10.jpg`.
 * - `sensitivity: 'base'` treats letter case and most diacritics as
 *   equal, so the order of `A.css` and `a.css` is determined by their
 *   relative insertion position (stable sort), not by ASCII codepoint.
 *
 * Exported so tests can pin the exact `Intl.Collator` contract.
 */
export const naturalUrlCollator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: 'base',
});

/**
 * Sorts archive resources by their URL in natural order, returning a
 * new array (the input is left untouched). Natural order means
 * numeric segments are compared numerically (`image-2` < `image-10`)
 * rather than lexicographically. The sort is stable, so resources
 * whose URLs compare equal under {@link naturalUrlCollator} keep
 * their relative insertion order.
 * @param resources - The list of resources to sort. Only the `url`
 *   field is read, so any value compatible with `{ url: string }` is
 *   accepted (real `Resource` instances, plain mocks, etc.).
 * @returns A new array sorted by URL in natural order.
 * @example
 * ```ts
 * sortResourcesByUrl([
 *   { url: 'https://x/img-10.jpg' },
 *   { url: 'https://x/img-2.jpg' },
 *   { url: 'https://x/img-1.jpg' },
 * ]);
 * // → [{ url: 'https://x/img-1.jpg' }, { url: 'https://x/img-2.jpg' }, { url: 'https://x/img-10.jpg' }]
 * ```
 */
export function sortResourcesByUrl<T extends { readonly url: string }>(
	resources: readonly T[],
): T[] {
	return resources.toSorted((a, b) => naturalUrlCollator.compare(a.url, b.url));
}
