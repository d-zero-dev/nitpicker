import type { MismatchesCursorPayload } from './types.js';

import { decodeCursorEnvelope } from '../viewer-cursor-kit/decode-cursor-envelope.js';

/**
 * The current request's identity to validate a decoded cursor against.
 */
export interface ExpectedMismatchesCursor {
	/** See `buildMismatchesFilterKey`. */
	filterKey: string;
	/** The current request's sort direction. */
	sortOrder: 'asc' | 'desc';
}

/**
 * Decodes and validates an opaque cursor against the caller's current
 * `type`/sort. Rejects cursors minted under a different schema version or a
 * different `type`/sort combination — replaying a cursor across a changed
 * query would silently seek to a nonsensical position. Thin wrapper over the
 * shared {@link decodeCursorEnvelope}; the keyset tuple is always
 * `(url_sort_key, mismatch_id)` (see `MismatchesSortSpec`'s docs), so no
 * per-position type check is needed.
 * @param cursor - The opaque cursor string from the request.
 * @param expected - The current request's filter key + sort, to validate against.
 * @returns The decoded, validated payload.
 * @throws {Error} If the cursor is malformed, stale, or was minted under a
 *   different `type`/sort combination.
 */
export function decodeMismatchesCursor(
	cursor: string,
	expected: ExpectedMismatchesCursor,
): MismatchesCursorPayload {
	return decodeCursorEnvelope(
		cursor,
		{
			filterKey: expected.filterKey,
			sortBy: 'url',
			sortOrder: expected.sortOrder,
			expectedValueCount: 2,
		},
		'/api/mismatches',
	);
}
