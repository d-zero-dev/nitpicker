import type { ViewerUnusedResourcesCursorFilterKeyInput } from './types.js';

/**
 * Builds the normalized `filterKey` embedded in a `/api/unused-resources`
 * cursor. Two calls with the same effective filters (regardless of
 * `undefined` vs omitted key order) always produce the same string.
 * @param filters - The filter-affecting subset of the caller's options.
 * @returns A canonical JSON string uniquely identifying the filter set.
 */
export function buildViewerUnusedResourcesFilterKey(
	filters: ViewerUnusedResourcesCursorFilterKeyInput,
): string {
	return JSON.stringify({
		status: filters.status ?? null,
		source: filters.source ?? null,
	});
}
