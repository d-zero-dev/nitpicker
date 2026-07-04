import type { ViewerUnusedResourcesCursorPayload } from './types.js';

/**
 * Encodes a `/api/unused-resources` cursor payload as an opaque, URL-safe
 * string.
 * @param payload - The cursor payload to encode.
 * @returns The base64url-encoded cursor.
 */
export function encodeViewerUnusedResourcesCursor(
	payload: ViewerUnusedResourcesCursorPayload,
): string {
	return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
