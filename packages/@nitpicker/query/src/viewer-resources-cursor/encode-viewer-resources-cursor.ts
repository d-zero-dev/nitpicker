import type { ViewerResourcesCursorPayload } from './types.js';

import { encodeCursorEnvelope } from '../viewer-cursor-kit/encode-cursor-envelope.js';

/**
 * Encodes a `/api/resources` cursor payload as an opaque, URL-safe string.
 * Thin wrapper over the shared {@link encodeCursorEnvelope}.
 * @param payload - The cursor payload to encode.
 * @returns The base64url-encoded cursor.
 */
export function encodeViewerResourcesCursor(
	payload: ViewerResourcesCursorPayload,
): string {
	return encodeCursorEnvelope(payload);
}
