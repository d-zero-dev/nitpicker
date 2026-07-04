import type { ViewerResourcesCursorFilterKeyInput } from './types.js';

/**
 * Builds the normalized `filterKey` embedded in a `/api/resources` cursor.
 * Two calls with the same effective filters (regardless of `undefined` vs
 * omitted key order) always produce the same string.
 * @param filters - The filter-affecting subset of the caller's options.
 * @returns A canonical JSON string uniquely identifying the filter set.
 */
export function buildViewerResourcesFilterKey(
	filters: ViewerResourcesCursorFilterKeyInput,
): string {
	return JSON.stringify({
		isExternal: filters.isExternal ?? null,
		status: filters.status ?? null,
	});
}
