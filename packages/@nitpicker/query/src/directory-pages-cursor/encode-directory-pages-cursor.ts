import type { DirectoryPagesCursorPayload } from './types.js';

/**
 * Encodes a `/api/directory-tree/pages` cursor payload as an opaque,
 * URL-safe string.
 * @param payload - The cursor payload to encode.
 * @returns The base64url-encoded cursor.
 */
export function encodeDirectoryPagesCursor(payload: DirectoryPagesCursorPayload): string {
	return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
