import type { DuplicateGroupPagesCursorPayload } from './types.js';

import { decodeCursorEnvelope } from '../viewer-cursor-kit/decode-cursor-envelope.js';

/**
 * The current request's identity to validate a decoded cursor against.
 */
export interface ExpectedDuplicateGroupPagesCursor {
	/** See `buildDuplicateGroupPagesFilterKey`. */
	filterKey: string;
}

/**
 * Decodes and validates an opaque cursor against the caller's current
 * `groupId`. Rejects cursors minted under a different schema version or a
 * different `groupId` — replaying a cursor minted for one group against
 * another would silently seek to a nonsensical position. Thin wrapper over
 * the shared {@link decodeCursorEnvelope}.
 * @param cursor - The opaque cursor string from the request.
 * @param expected - The current request's filter key, to validate against.
 * @returns The decoded, validated payload.
 * @throws {Error} If the cursor is malformed, stale, or was minted under a
 *   different `groupId`.
 */
export function decodeDuplicateGroupPagesCursor(
	cursor: string,
	expected: ExpectedDuplicateGroupPagesCursor,
): DuplicateGroupPagesCursorPayload {
	return decodeCursorEnvelope(
		cursor,
		{
			filterKey: expected.filterKey,
			sortBy: 'url',
			sortOrder: 'asc',
			expectedValueCount: 2,
		},
		'/api/duplicates/:groupId/pages',
	);
}
