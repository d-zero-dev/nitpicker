import type { ViewerPagesSortSpec } from './types.js';

/**
 * Resolves the keyset sort plan for a `sortBy`/`sortOrder` pair.
 * @param sortBy - The field to sort by.
 * @param sortOrder - The sort direction.
 * @returns The resolved {@link ViewerPagesSortSpec}.
 */
export function getViewerPagesSortSpec(
	sortBy:
		| 'url'
		| 'status'
		| 'title'
		| 'mainContentWordCount'
		| 'mainContentBodyWordCount'
		| 'mainContentHeadingCount'
		| 'mainContentImageCount'
		| 'mainContentTableCount'
		| 'mainContentButtonCount'
		| 'mainContentIframeCount'
		| 'mainContentVideoCount'
		| 'mainContentAudioCount'
		| 'mainContentCanvasCount'
		| 'scrollHeightDesktop'
		| 'scrollHeightMobile',
	sortOrder: 'asc' | 'desc',
): ViewerPagesSortSpec {
	switch (sortBy) {
		case 'status': {
			return {
				columns: [
					sortOrder === 'desc' ? 'status_desc_key' : 'status_sort_key',
					'url_sort_key',
					'page_id',
				],
				scanDirection: 'asc',
			};
		}
		case 'title': {
			return {
				columns: ['title_sort_key', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		case 'mainContentWordCount': {
			return {
				columns: ['main_content_word_count', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		case 'mainContentBodyWordCount': {
			return {
				columns: ['main_content_body_word_count', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		case 'mainContentHeadingCount': {
			return {
				columns: ['main_content_heading_count', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		case 'mainContentImageCount': {
			return {
				columns: ['main_content_image_count', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		case 'mainContentTableCount': {
			return {
				columns: ['main_content_table_count', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		case 'mainContentButtonCount': {
			return {
				columns: ['main_content_button_count', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		case 'mainContentIframeCount': {
			return {
				columns: ['main_content_iframe_count', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		case 'mainContentVideoCount': {
			return {
				columns: ['main_content_video_count', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		case 'mainContentAudioCount': {
			return {
				columns: ['main_content_audio_count', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		case 'mainContentCanvasCount': {
			return {
				columns: ['main_content_canvas_count', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		case 'scrollHeightDesktop': {
			return {
				columns: ['scroll_height_desktop', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		case 'scrollHeightMobile': {
			return {
				columns: ['scroll_height_mobile', 'url_sort_key', 'page_id'],
				scanDirection: sortOrder,
			};
		}
		default: {
			return { columns: ['natural_url_rank', 'page_id'], scanDirection: sortOrder };
		}
	}
}
