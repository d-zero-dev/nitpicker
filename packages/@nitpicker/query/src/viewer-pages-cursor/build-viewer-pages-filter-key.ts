import type { ViewerPagesCursorFilterKeyInput } from './types.js';

/**
 * Builds the normalized `filterKey` embedded in a cursor. Two calls with the
 * same effective filters (regardless of `undefined` vs omitted key order)
 * always produce the same string.
 * @param filters - The filter-affecting subset of the caller's options.
 * @returns A canonical JSON string uniquely identifying the filter set.
 */
export function buildViewerPagesFilterKey(
	filters: ViewerPagesCursorFilterKeyInput,
): string {
	return JSON.stringify({
		isExternal: filters.isExternal ?? null,
		contentTypeCategory: filters.contentTypeCategory ?? null,
		status: filters.status ?? null,
		statusMin: filters.statusMin ?? null,
		statusMax: filters.statusMax ?? null,
		missingTitle: filters.missingTitle ?? null,
		missingDescription: filters.missingDescription ?? null,
		noindex: filters.noindex ?? null,
		source: filters.source ?? null,
	});
}
