import type { InboundLinksCursorPayload } from './types.js';

import { decodeCursorEnvelope } from '../viewer-cursor-kit/decode-cursor-envelope.js';

/**
 * The current request's identity to validate a decoded cursor against.
 */
export interface ExpectedInboundLinksCursor {
	/** See `buildInboundLinksFilterKey`. */
	filterKey: string;
}

/**
 * Decodes and validates an opaque cursor against the caller's current
 * `destPageId`. Rejects cursors minted under a different schema version or a
 * different `destPageId` — replaying a cursor minted for one page's inbound
 * links against another's would silently seek to a nonsensical position.
 * Thin wrapper over the shared {@link decodeCursorEnvelope}.
 * @param cursor - The opaque cursor string from the request.
 * @param expected - The current request's filter key, to validate against.
 * @returns The decoded, validated payload.
 * @throws {Error} If the cursor is malformed, stale, or was minted under a
 *   different `destPageId`.
 */
export function decodeInboundLinksCursor(
	cursor: string,
	expected: ExpectedInboundLinksCursor,
): InboundLinksCursorPayload {
	return decodeCursorEnvelope(
		cursor,
		{
			filterKey: expected.filterKey,
			sortBy: 'edgeId',
			sortOrder: 'asc',
			expectedValueCount: 1,
		},
		'/api/pages/inbound-links',
	);
}
