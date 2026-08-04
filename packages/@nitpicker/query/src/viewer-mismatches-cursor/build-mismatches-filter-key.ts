import type { MismatchesCursorFilterKeyInput } from './types.js';

import { buildFilterKey } from '../viewer-cursor-kit/build-filter-key.js';

/**
 * Builds the normalized `filterKey` embedded in a cursor. Thin wrapper over
 * the shared {@link buildFilterKey}.
 * @param filters - The filter-affecting subset of the caller's options.
 * @returns A canonical JSON string uniquely identifying the filter set.
 */
export function buildMismatchesFilterKey(
	filters: MismatchesCursorFilterKeyInput,
): string {
	return buildFilterKey({ type: filters.type, urlPattern: filters.urlPattern });
}
