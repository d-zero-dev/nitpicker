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
 * @param mainContents - Beholder's per-page main-content metrics, or `null`/`undefined`.
 * @param scrollHeight - Beholder's per-page scroll-height measurements, or `null`/`undefined`.
 * @returns The seventeen denormalised columns.
 */
export function computeMainContentsDenormalized(
	mainContents: MainContentsData | null | undefined,
	scrollHeight: ScrollHeightData | null | undefined,
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
		scroll_height_desktop: scrollHeight?.desktop ?? null,
		scroll_height_mobile: scrollHeight?.mobile ?? null,
	};
}
