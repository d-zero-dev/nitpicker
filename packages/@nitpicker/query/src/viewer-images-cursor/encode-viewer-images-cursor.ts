import type { ViewerImagesCursorPayload } from './types.js';

import { encodeCursorEnvelope } from '../viewer-cursor-kit/encode-cursor-envelope.js';

/**
 * Encodes a `/api/images` cursor payload as an opaque, URL-safe string. Thin
 * wrapper over the shared {@link encodeCursorEnvelope}.
 * @param payload - The cursor payload to encode.
 * @returns The base64url-encoded cursor.
 */
export function encodeViewerImagesCursor(payload: ViewerImagesCursorPayload): string {
	return encodeCursorEnvelope(payload);
}
