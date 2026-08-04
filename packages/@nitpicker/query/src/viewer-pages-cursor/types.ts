/**
 * The columns (in tuple order) that make up a given sort's keyset — both the
 * `ORDER BY` clause and the cursor comparison tuple. Always ends in
 * `page_id`, the stable tie-breaker.
 */
export type ViewerPagesSortColumn =
	| 'url_sort_key'
	| 'natural_url_rank'
	| 'title_sort_key'
	| 'status_sort_key'
	| 'status_desc_key'
	| 'main_content_word_count'
	| 'main_content_body_word_count'
	| 'main_content_heading_count'
	| 'main_content_image_count'
	| 'main_content_table_count'
	| 'main_content_button_count'
	| 'main_content_iframe_count'
	| 'main_content_video_count'
	| 'main_content_audio_count'
	| 'main_content_canvas_count'
	| 'scroll_height_desktop'
	| 'scroll_height_mobile'
	| 'console_error_count'
	| 'page_id';

/**
 * Resolved sort plan for one `sortBy`/`sortOrder` pair: which `viewer_pages`
 * columns form the keyset tuple, and which physical scan direction (`asc`/
 * `desc`) reads them in display order.
 *
 * `status` desc uses `status_desc_key` (`= -status_sort_key`) walked
 * ascending, so the tie-breakers (`url_sort_key`, `page_id`) stay ascending
 * too — ties always display in URL order regardless of the primary sort
 * direction, and the keyset comparison stays a uniform single-direction
 * row-value tuple (which can't mix per-column directions).
 * `url`/`title` can't use this negation trick (text has no numeric negation),
 * so their tie-breakers simply follow the same direction as the primary
 * column.
 */
export interface ViewerPagesSortSpec {
	/** Keyset tuple columns, in comparison/`ORDER BY` order. */
	readonly columns: readonly ViewerPagesSortColumn[];
	/** Physical scan direction that yields display order for `columns`. */
	readonly scanDirection: 'asc' | 'desc';
}

/** One `viewer_pages` row's worth of keyset column values, keyed by column name. */
export type ViewerPagesKeysetRow = Record<ViewerPagesSortColumn, string | number> & {
	page_id: number;
};

/**
 * The subset of `ListViewerPagesOptions` (see `../types.js`) that affects
 * which rows match — used to build a cursor's `filterKey` so a cursor minted
 * under one filter/sort combination can't silently be replayed under
 * another (the results would be nonsensical: the keyset comparison columns
 * wouldn't mean the same thing).
 */
export interface ViewerPagesCursorFilterKeyInput {
	/** See `ListViewerPagesOptions.isExternal`. */
	isExternal?: boolean;
	/** See `ListViewerPagesOptions.contentTypeCategory`. */
	contentTypeCategory?: string | string[];
	/** See `ListViewerPagesOptions.status`. */
	status?: number | number[];
	/** See `ListViewerPagesOptions.statusMin`. */
	statusMin?: number;
	/** See `ListViewerPagesOptions.statusMax`. */
	statusMax?: number;
	/** See `ListViewerPagesOptions.missingTitle`. */
	missingTitle?: boolean;
	/** See `ListViewerPagesOptions.missingDescription`. */
	missingDescription?: boolean;
	/** See `ListViewerPagesOptions.noindex`. */
	noindex?: boolean;
	/** See `ListViewerPagesOptions.lang`. */
	lang?: string;
	/** See `ListViewerPagesOptions.hasCSP`. */
	hasCSP?: boolean;
	/** See `ListViewerPagesOptions.hasXFrameOptions`. */
	hasXFrameOptions?: boolean;
	/** See `ListViewerPagesOptions.hasXContentTypeOptions`. */
	hasXContentTypeOptions?: boolean;
	/** See `ListViewerPagesOptions.hasHSTS`. */
	hasHSTS?: boolean;
	/** See `ListViewerPagesOptions.source`. */
	source?: string;
	/** See `ListViewerPagesOptions.templateKey`. */
	templateKey?: string | string[];
	/** See `ListViewerPagesOptions.directory`. */
	directory?: string;
	/** See `ListViewerPagesOptions.urlPattern`. */
	urlPattern?: string;
}

/**
 * Decoded shape of an opaque `/api/pages` viewer cursor.
 */
export interface ViewerPagesCursorPayload {
	/**
	 * The read-model schema version the cursor was minted under (see
	 * `VIEWER_READ_MODEL_SCHEMA_VERSION`). A schema bump changes column
	 * meanings (or removes them), so a cursor from a stale schema must never
	 * be replayed.
	 */
	v: number;
	/** See `buildViewerPagesFilterKey`. */
	filterKey: string;
	/** The sort field the cursor was minted under. */
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
		| 'scrollHeightMobile'
		| 'consoleErrorCount';
	/** The sort direction the cursor was minted under. */
	sortOrder: 'asc' | 'desc';
	/** The boundary row's keyset tuple values, in sort-spec column order. */
	values: (string | number)[];
}
