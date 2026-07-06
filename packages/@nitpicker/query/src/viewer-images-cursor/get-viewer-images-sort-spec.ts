import type { ViewerImagesSortSpec } from './types.js';
import type { ListViewerImagesOptions } from '../types.js';

/** Maps a `ListViewerImagesOptions.sortBy` value to its `viewer_images` primary sort column. */
const PRIMARY_COLUMN_BY_SORT_BY = {
	pageUrl: 'page_url_rank',
	width: 'width',
	height: 'height',
	naturalWidth: 'natural_width',
	naturalHeight: 'natural_height',
	isLazy: 'is_lazy',
} as const;

/**
 * Resolves the keyset sort plan for a `/api/images` `sortBy`/`sortOrder`
 * pair. Every supported field is a single, non-nullable `viewer_images`
 * column with `image_id` as an arbitrary tie-breaker, so — unlike
 * `viewer_resources`'s `status` sort — descending order never needs a
 * `_desc_key` column: flipping the physical scan direction for both the
 * primary column and the tie-breaker together still yields a valid total
 * order (tie-break order for equal primary values is not a display
 * requirement, just determinism).
 * @param sortBy - The field to sort by.
 * @param sortOrder - The sort direction.
 * @returns The resolved {@link ViewerImagesSortSpec}.
 */
export function getViewerImagesSortSpec(
	sortBy: NonNullable<ListViewerImagesOptions['sortBy']>,
	sortOrder: 'asc' | 'desc',
): ViewerImagesSortSpec {
	return {
		columns: [PRIMARY_COLUMN_BY_SORT_BY[sortBy], 'image_id'],
		scanDirection: sortOrder,
	};
}
