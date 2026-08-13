/** Every valid `/api/pages` `sortBy` value, for the runtime guard below. */
const PAGE_SORT_BY_VALUES = [
	'url',
	'status',
	'title',
	'mainContentWordCount',
	'mainContentBodyWordCount',
	'mainContentHeadingCount',
	'mainContentImageCount',
	'mainContentTableCount',
	'mainContentButtonCount',
	'mainContentIframeCount',
	'mainContentVideoCount',
	'mainContentAudioCount',
	'mainContentCanvasCount',
	'mainContentCustomElementCount',
	'scrollHeightDesktop',
	'scrollHeightMobile',
] as const;

/** A validated `/api/pages` sort field. */
export type PageSortBy = (typeof PAGE_SORT_BY_VALUES)[number];

/**
 * Parses a raw query-string value into a {@link PageSortBy}.
 *
 * Returns `undefined` for missing or unrecognised values, matching the
 * silent-drop convention `toContentTypeCategory` / `toPageSource` use in
 * this directory. This validation matters more here than on the live
 * `listPages` path: the `viewer_pages` fast path embeds `sortBy` into every
 * cursor's identity (`buildViewerPagesFilterKey`), so an unvalidated garbage
 * value would get baked into a cursor and then permanently rejected by
 * `decodeViewerPagesCursor` on the next (corrected) request — surfacing as
 * a confusing pagination error instead of just falling back to the default
 * sort.
 * @param raw - The raw query-string value.
 * @returns The narrowed sort field or `undefined`.
 */
export function toPageSortBy(raw: string | undefined): PageSortBy | undefined {
	if (!raw) {
		return undefined;
	}
	return (PAGE_SORT_BY_VALUES as readonly string[]).includes(raw)
		? (raw as PageSortBy)
		: undefined;
}
