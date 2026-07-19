import type { DuplicateGroupsCursorPayload } from './types.js';

import { encodeCursorEnvelope } from '../viewer-cursor-kit/encode-cursor-envelope.js';

/**
 * Encodes a cursor payload as an opaque, URL-safe string. Thin wrapper over
 * the shared {@link encodeCursorEnvelope}.
 * @param payload - The cursor payload to encode.
 * @returns The base64url-encoded cursor.
 */
export function encodeDuplicateGroupsCursor(
	payload: DuplicateGroupsCursorPayload,
): string {
	return encodeCursorEnvelope(payload);
}
