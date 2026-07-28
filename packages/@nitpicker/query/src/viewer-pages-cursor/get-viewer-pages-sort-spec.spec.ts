import { describe, expect, it } from 'vitest';

import { getViewerPagesSortSpec } from './get-viewer-pages-sort-spec.js';

describe('getViewerPagesSortSpec', () => {
	it('sorts by url ascending using natural_url_rank/page_id, scanned ascending', () => {
		expect(getViewerPagesSortSpec('url', 'asc')).toEqual({
			columns: ['natural_url_rank', 'page_id'],
			scanDirection: 'asc',
		});
	});

	it('sorts by url descending using the same columns, scanned descending', () => {
		expect(getViewerPagesSortSpec('url', 'desc')).toEqual({
			columns: ['natural_url_rank', 'page_id'],
			scanDirection: 'desc',
		});
	});

	it('sorts by title using title_sort_key with url_sort_key/page_id tie-breakers, same-direction scan', () => {
		expect(getViewerPagesSortSpec('title', 'asc')).toEqual({
			columns: ['title_sort_key', 'url_sort_key', 'page_id'],
			scanDirection: 'asc',
		});
		expect(getViewerPagesSortSpec('title', 'desc')).toEqual({
			columns: ['title_sort_key', 'url_sort_key', 'page_id'],
			scanDirection: 'desc',
		});
	});

	it('sorts by status ascending using status_sort_key, scanned ascending', () => {
		expect(getViewerPagesSortSpec('status', 'asc')).toEqual({
			columns: ['status_sort_key', 'url_sort_key', 'page_id'],
			scanDirection: 'asc',
		});
	});

	it('sorts by status descending using the negated status_desc_key, ALWAYS scanned ascending', () => {
		// status_desc_key = -status_sort_key, so walking it ascending yields
		// status descending while keeping the url/page_id tie-breakers ascending
		// too — ties display in URL order regardless of primary direction.
		expect(getViewerPagesSortSpec('status', 'desc')).toEqual({
			columns: ['status_desc_key', 'url_sort_key', 'page_id'],
			scanDirection: 'asc',
		});
	});

	it('sorts by mainContentWordCount using the plain column with url_sort_key/page_id tie-breakers, same-direction scan', () => {
		expect(getViewerPagesSortSpec('mainContentWordCount', 'asc')).toEqual({
			columns: ['main_content_word_count', 'url_sort_key', 'page_id'],
			scanDirection: 'asc',
		});
		expect(getViewerPagesSortSpec('mainContentWordCount', 'desc')).toEqual({
			columns: ['main_content_word_count', 'url_sort_key', 'page_id'],
			scanDirection: 'desc',
		});
	});

	it('sorts by scrollHeightDesktop using the plain column with url_sort_key/page_id tie-breakers', () => {
		expect(getViewerPagesSortSpec('scrollHeightDesktop', 'asc')).toEqual({
			columns: ['scroll_height_desktop', 'url_sort_key', 'page_id'],
			scanDirection: 'asc',
		});
	});

	it('resolves every main-content / scroll-height sortBy to its matching column, same-direction scan (no negation trick, unlike status)', () => {
		const cases: [
			Parameters<typeof getViewerPagesSortSpec>[0],
			ReturnType<typeof getViewerPagesSortSpec>['columns'][0],
		][] = [
			['mainContentWordCount', 'main_content_word_count'],
			['mainContentBodyWordCount', 'main_content_body_word_count'],
			['mainContentHeadingCount', 'main_content_heading_count'],
			['mainContentImageCount', 'main_content_image_count'],
			['mainContentTableCount', 'main_content_table_count'],
			['mainContentButtonCount', 'main_content_button_count'],
			['mainContentIframeCount', 'main_content_iframe_count'],
			['mainContentVideoCount', 'main_content_video_count'],
			['mainContentAudioCount', 'main_content_audio_count'],
			['mainContentCanvasCount', 'main_content_canvas_count'],
			['scrollHeightDesktop', 'scroll_height_desktop'],
			['scrollHeightMobile', 'scroll_height_mobile'],
			['consoleErrorCount', 'console_error_count'],
		];
		for (const [sortBy, column] of cases) {
			expect(getViewerPagesSortSpec(sortBy, 'desc')).toEqual({
				columns: [column, 'url_sort_key', 'page_id'],
				scanDirection: 'desc',
			});
		}
	});
});
