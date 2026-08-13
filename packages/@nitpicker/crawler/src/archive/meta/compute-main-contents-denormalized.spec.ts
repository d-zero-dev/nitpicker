import type { MainContentsData, ScrollHeightData } from '@d-zero/beholder';

import { describe, it, expect } from 'vitest';

import { computeMainContentsDenormalized } from './compute-main-contents-denormalized.js';

/**
 * Builds a minimal valid {@link MainContentsData} object with a detected main region.
 * @param overrides
 */
function makeMainContents(overrides: Partial<MainContentsData> = {}): MainContentsData {
	return {
		title: 'Test',
		main: {
			nodeName: 'MAIN',
			id: null,
			classList: ['l-main'],
			role: null,
			selector: 'main.l-main',
		},
		wordCount: 100,
		bodyWordCount: 150,
		headings: [],
		images: [],
		tables: [],
		buttons: [],
		iframes: [],
		videos: [],
		audios: [],
		canvases: [],
		...overrides,
	};
}

const scrollHeight: ScrollHeightData = { desktop: 3200, mobile: 5400 };

describe('computeMainContentsDenormalized', () => {
	it('returns all-null columns when mainContents is null', () => {
		expect(computeMainContentsDenormalized(null, scrollHeight)).toEqual({
			main_content_node_name: null,
			main_content_id: null,
			main_content_role: null,
			main_content_selector: null,
			main_content_class_list: null,
			main_content_word_count: null,
			main_content_body_word_count: null,
			main_content_heading_count: null,
			main_content_image_count: null,
			main_content_table_count: null,
			main_content_button_count: null,
			main_content_iframe_count: null,
			main_content_video_count: null,
			main_content_audio_count: null,
			main_content_canvas_count: null,
			main_content_custom_element_count: null,
			scroll_height_desktop: null,
			scroll_height_mobile: null,
		});
	});

	it('returns null main_content_custom_element_count when mainContents is null even if customElementCount is passed', () => {
		const result = computeMainContentsDenormalized(null, scrollHeight, 3);
		expect(result.main_content_custom_element_count).toBeNull();
	});

	it('returns null main_content_custom_element_count when customElementCount is undefined or null', () => {
		expect(
			computeMainContentsDenormalized(makeMainContents(), scrollHeight)
				.main_content_custom_element_count,
		).toBeNull();
		expect(
			computeMainContentsDenormalized(makeMainContents(), scrollHeight, null)
				.main_content_custom_element_count,
		).toBeNull();
	});

	it('reflects the captured custom element count, including zero', () => {
		expect(
			computeMainContentsDenormalized(makeMainContents(), scrollHeight, 0)
				.main_content_custom_element_count,
		).toBe(0);
		expect(
			computeMainContentsDenormalized(makeMainContents(), scrollHeight, 2)
				.main_content_custom_element_count,
		).toBe(2);
	});

	it('returns null scroll heights when scrollHeight is null', () => {
		const result = computeMainContentsDenormalized(makeMainContents(), null);
		expect(result.scroll_height_desktop).toBeNull();
		expect(result.scroll_height_mobile).toBeNull();
	});

	it('projects the detected main element and JSON-encodes classList', () => {
		const result = computeMainContentsDenormalized(makeMainContents(), scrollHeight);
		expect(result.main_content_node_name).toBe('MAIN');
		expect(result.main_content_selector).toBe('main.l-main');
		expect(result.main_content_class_list).toBe('["l-main"]');
		expect(result.scroll_height_desktop).toBe(3200);
		expect(result.scroll_height_mobile).toBe(5400);
	});

	it('returns null main-element columns when no main region was found', () => {
		const result = computeMainContentsDenormalized(
			makeMainContents({ main: null, wordCount: 0 }),
			scrollHeight,
		);
		expect(result.main_content_node_name).toBeNull();
		expect(result.main_content_selector).toBeNull();
		expect(result.main_content_class_list).toBeNull();
		expect(result.main_content_word_count).toBe(0);
	});

	it('counts each sub-entity array independently', () => {
		const result = computeMainContentsDenormalized(
			makeMainContents({
				headings: [{ text: 'A', level: 1 }],
				images: [
					{ src: 'https://example.com/a.png', alt: '' },
					{ src: 'https://example.com/b.png', alt: '' },
				],
				tables: [
					{ rows: 1, cols: 1, hasHeader: false, hasFooter: false, hasMergedCell: false },
				],
				buttons: [
					{ nodeName: 'BUTTON', role: null, type: 'submit', text: 'Go', disabled: false },
				],
				iframes: [
					{ src: 'https://example.com/f', title: null, width: null, height: null },
				],
				videos: [
					{ src: 'https://example.com/v.mp4', poster: null, width: 640, height: 480 },
				],
				audios: [{ src: 'https://example.com/a.mp3' }],
				canvases: [{ width: 100, height: 100 }],
			}),
			scrollHeight,
		);
		expect(result.main_content_heading_count).toBe(1);
		expect(result.main_content_image_count).toBe(2);
		expect(result.main_content_table_count).toBe(1);
		expect(result.main_content_button_count).toBe(1);
		expect(result.main_content_iframe_count).toBe(1);
		expect(result.main_content_video_count).toBe(1);
		expect(result.main_content_audio_count).toBe(1);
		expect(result.main_content_canvas_count).toBe(1);
	});
});
