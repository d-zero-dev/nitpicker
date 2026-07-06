import type { CursorEnvelope } from './types.js';

/**
 * Encodes a cursor payload as an opaque, URL-safe string. Shared by every
 * `viewer_*` table's keyset-cursor module.
 * @param payload - The cursor payload to encode.
 * @returns The base64url-encoded cursor.
 */
export function encodeCursorEnvelope<SortBy extends string>(
	payload: CursorEnvelope<SortBy>,
): string {
	return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
