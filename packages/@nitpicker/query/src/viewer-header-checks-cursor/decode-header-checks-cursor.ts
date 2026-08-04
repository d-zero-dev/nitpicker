import type { HeaderChecksCursorPayload, HeaderChecksEffectiveSortBy } from './types.js';

import { decodeCursorEnvelope } from '../viewer-cursor-kit/decode-cursor-envelope.js';

/**
 * The current request's identity to validate a decoded cursor against.
 */
export interface ExpectedHeaderChecksCursor {
	/** See `buildHeaderChecksFilterKey`. */
	filterKey: string;
	/** The current request's effective sort field — see {@link HeaderChecksEffectiveSortBy}. */
	sortBy: HeaderChecksEffectiveSortBy;
	/** The current request's sort direction. */
	sortOrder: 'asc' | 'desc';
}

/**
 * Decodes and validates an opaque cursor against the caller's current
 * filters/sort. Rejects cursors minted under a different schema version or a
 * different effective filter/sort combination — replaying a cursor across a
 * changed query would silently seek to a nonsensical position. Thin wrapper
 * over the shared {@link decodeCursorEnvelope}; both keyset tuples are 2
 * values ending in `page_id` (see `getHeaderChecksSortSpec`), so unlike
 * `viewer-anchor-facts-cursor` no per-position type check is needed —
 * `expectedValueCount: 2` alone catches a malformed `values` array.
 * @param cursor - The opaque cursor string from the request.
 * @param expected - The current request's filter key + sort, to validate against.
 * @returns The decoded, validated payload.
 * @throws {Error} If the cursor is malformed, stale, or was minted under a
 *   different filter/sort combination.
 */
export function decodeHeaderChecksCursor(
	cursor: string,
	expected: ExpectedHeaderChecksCursor,
): HeaderChecksCursorPayload {
	return decodeCursorEnvelope(
		cursor,
		{
			filterKey: expected.filterKey,
			sortBy: expected.sortBy,
			sortOrder: expected.sortOrder,
			expectedValueCount: 2,
		},
		'/api/headers',
	);
}
