import type { MainContentsDenormalizedColumns } from './types.js';
import type { MainContentsData, ScrollHeightData } from '@d-zero/beholder';

/**
 * Computes the `page_meta.main_content_*` / `scroll_height_*` denormalised
 * aggregate columns from beholder's `MainContentsData` / `ScrollHeightData`.
 *
 * `mainContents` is `null` for pages that were not fully rendered (external,
 * non-HTML, or metadata-only scrapes) — in that case every column is `null`.
 * This mirrors {@link import('./compute-page-denormalized.js').computePageDenormalized}'s
 * write-once-at-scrape-time pattern so list / detail reads never re-derive
 * counts from the `page_main_content_*` child tables.
 *
 * Accepts `undefined` as well as `null`: `PageData` declares `mainContents`
 * as required, but test fixtures across the codebase predate this field and
 * omit it (`.spec.ts` files are excluded from the `tsc` build, so this goes
 * uncaught at compile time) — `== null` tolerates both without forcing every
 * fixture to be updated.
 *
 * `customElementCount` is a separate parameter, not read off `mainContents`,
 * because it is not one of beholder's `MainContentsData` categories —
 * nitpicker captures Web Components itself (`crawler/capture-custom-elements.ts`)
 * after `scrapeStart` returns. It carries three distinct states:
 * `undefined`/capture-not-attempted and capture-failure both collapse to
 * `null` (unknown — NOT the same as "captured, zero found"), while any
 * number (including `0`) means capture succeeded.
 * @param mainContents - Beholder's per-page main-content metrics, or `null`/`undefined`.
 * @param scrollHeight - Beholder's per-page scroll-height measurements, or `null`/`undefined`.
 * @param customElementCount - Count of Web Components nitpicker captured in
 *   the main-content region, or `null`/`undefined` when capture was not
 *   attempted or failed.
 * @returns The eighteen denormalised columns.
 */
export function computeMainContentsDenormalized(
	mainContents: MainContentsData | null | undefined,
	scrollHeight: ScrollHeightData | null | undefined,
	customElementCount?: number | null,
): MainContentsDenormalizedColumns {
	if (mainContents == null) {
		return {
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
		};
	}
	return {
		main_content_node_name: mainContents.main?.nodeName ?? null,
		main_content_id: mainContents.main?.id ?? null,
		main_content_role: mainContents.main?.role ?? null,
		main_content_selector: mainContents.main?.selector ?? null,
		main_content_class_list: mainContents.main
			? JSON.stringify(mainContents.main.classList)
			: null,
		main_content_word_count: mainContents.wordCount,
		main_content_body_word_count: mainContents.bodyWordCount,
		main_content_heading_count: mainContents.headings.length,
		main_content_image_count: mainContents.images.length,
		main_content_table_count: mainContents.tables.length,
		main_content_button_count: mainContents.buttons.length,
		main_content_iframe_count: mainContents.iframes.length,
		main_content_video_count: mainContents.videos.length,
		main_content_audio_count: mainContents.audios.length,
		main_content_canvas_count: mainContents.canvases.length,
		main_content_custom_element_count: customElementCount ?? null,
		scroll_height_desktop: scrollHeight?.desktop ?? null,
		scroll_height_mobile: scrollHeight?.mobile ?? null,
	};
}
