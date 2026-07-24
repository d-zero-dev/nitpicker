import type { ViewerPagesCursorFilterKeyInput } from './types.js';

import { buildFilterKey } from '../viewer-cursor-kit/build-filter-key.js';

/**
 * Builds the normalized `filterKey` embedded in a cursor. Two calls with the
 * same effective filters (regardless of `undefined` vs omitted key order)
 * always produce the same string. Thin wrapper over the shared
 * {@link buildFilterKey}.
 * @param filters - The filter-affecting subset of the caller's options.
 * @returns A canonical JSON string uniquely identifying the filter set.
 */
export function buildViewerPagesFilterKey(
	filters: ViewerPagesCursorFilterKeyInput,
): string {
	return buildFilterKey({
		isExternal: filters.isExternal,
		contentTypeCategory: filters.contentTypeCategory,
		status: filters.status,
		statusMin: filters.statusMin,
		statusMax: filters.statusMax,
		missingTitle: filters.missingTitle,
		missingDescription: filters.missingDescription,
		noindex: filters.noindex,
		source: filters.source,
		templateKey: filters.templateKey,
		directory: filters.directory,
	});
}
