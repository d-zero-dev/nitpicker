import type { ViewerPagesCursorPayload } from './types.js';

/**
 * Encodes a cursor payload as an opaque, URL-safe string.
 * @param payload - The cursor payload to encode.
 * @returns The base64url-encoded cursor.
 */
export function encodeViewerPagesCursor(payload: ViewerPagesCursorPayload): string {
	return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
