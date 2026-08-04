import type { ListImagesOptions } from './types.js';

/** Every `sortBy` value the `viewer_images` fast path indexes (excludes `src`/`alt`). */
const FAST_PATH_SORT_BY_VALUES = new Set<ListImagesOptions['sortBy']>([
	'pageUrl',
	'width',
	'height',
	'naturalWidth',
	'naturalHeight',
	'isLazy',
]);

/**
 * Whether a `listImages` `sortBy` value is served by the `viewer_images`
 * read-model fast path (`src`/`alt` sort on large text columns the read
 * model never duplicates and force the live fallback instead — see
 * `getImagesFastPath`).
 *
 * The single source of truth for this set: `getImagesFastPath`'s own
 * dispatch AND the viewer route's stale-read-model refusal gate both
 * consult it, so the two can never drift apart when the fast path's sort
 * support changes.
 * @param sortBy - The candidate sort field.
 * @returns `true` iff the fast path serves this sort.
 * @example
 * isImagesFastPathSortBy('width'); // true
 * isImagesFastPathSortBy('src'); // false — large-text column, live only
 */
export function isImagesFastPathSortBy(sortBy: ListImagesOptions['sortBy']): boolean {
	return FAST_PATH_SORT_BY_VALUES.has(sortBy);
}
