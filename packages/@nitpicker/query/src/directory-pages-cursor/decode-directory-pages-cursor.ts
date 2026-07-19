import type { DirectoryPagesCursorPayload } from './types.js';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

/**
 * Decodes and validates an opaque `/api/directory-tree/pages` cursor against
 * the current request's `nodeId`. Rejects cursors minted under a different
 * schema version or a different `nodeId` — replaying a cursor against a
 * different directory would silently seek to a nonsensical position.
 * @param cursor - The opaque cursor string from the request.
 * @param expectedNodeId - The current request's `nodeId`.
 * @returns The decoded, validated payload.
 * @throws {Error} If the cursor is malformed, stale, or was minted for a
 *   different `nodeId`.
 */
export function decodeDirectoryPagesCursor(
	cursor: string,
	expectedNodeId: number,
): DirectoryPagesCursorPayload {
	let payload: DirectoryPagesCursorPayload;
	try {
		payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
	} catch {
		throw new Error('Invalid /api/directory-tree/pages cursor: not decodable');
	}
	if (
		typeof payload !== 'object' ||
		payload === null ||
		typeof payload.v !== 'number' ||
		typeof payload.nodeId !== 'number' ||
		typeof payload.pageUrlSortKey !== 'string' ||
		typeof payload.pageId !== 'number'
	) {
		throw new Error('Invalid /api/directory-tree/pages cursor: malformed payload');
	}
	if (payload.v !== VIEWER_READ_MODEL_SCHEMA_VERSION) {
		throw new Error(
			'Stale /api/directory-tree/pages cursor: read-model schema has changed since it was issued',
		);
	}
	if (payload.nodeId !== expectedNodeId) {
		throw new Error(
			'Invalid /api/directory-tree/pages cursor: does not match the current nodeId',
		);
	}
	return payload;
}
