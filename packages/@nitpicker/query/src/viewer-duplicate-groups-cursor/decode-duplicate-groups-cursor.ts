import type { DuplicateGroupsCursorPayload } from './types.js';

import { decodeCursorEnvelope } from '../viewer-cursor-kit/decode-cursor-envelope.js';

/**
 * The current request's identity to validate a decoded cursor against.
 */
export interface ExpectedDuplicateGroupsCursor {
	/** See `buildDuplicateGroupsFilterKey`. */
	filterKey: string;
}

/**
 * Decodes and validates an opaque cursor against the caller's current
 * filter. Rejects cursors minted under a different schema version or a
 * different `field` — replaying a cursor across a changed query would
 * silently seek to a nonsensical position. Thin wrapper over the shared
 * {@link decodeCursorEnvelope}; the keyset tuple is always `(count_desc_key,
 * group_id)` and the sort is always `'count'`/`'asc'` (see
 * `DuplicateGroupsSortSpec`'s docs), so unlike
 * `viewer-header-checks-cursor`/`viewer-mismatches-cursor` there is no
 * `sortOrder` to validate against.
 * @param cursor - The opaque cursor string from the request.
 * @param expected - The current request's filter key, to validate against.
 * @returns The decoded, validated payload.
 * @throws {Error} If the cursor is malformed, stale, or was minted under a
 *   different `field`.
 */
export function decodeDuplicateGroupsCursor(
	cursor: string,
	expected: ExpectedDuplicateGroupsCursor,
): DuplicateGroupsCursorPayload {
	return decodeCursorEnvelope(
		cursor,
		{
			filterKey: expected.filterKey,
			sortBy: 'count',
			sortOrder: 'asc',
			expectedValueCount: 2,
		},
		'/api/duplicates',
	);
}
