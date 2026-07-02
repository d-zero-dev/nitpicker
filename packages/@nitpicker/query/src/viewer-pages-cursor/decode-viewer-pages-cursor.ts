import type { ViewerPagesCursorPayload } from './types.js';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

/**
 * The current request's identity to validate a decoded cursor against.
 */
export interface ExpectedViewerPagesCursor {
	/** See `buildViewerPagesFilterKey`. */
	filterKey: string;
	/** The current request's sort field. */
	sortBy: 'url' | 'status' | 'title';
	/** The current request's sort direction. */
	sortOrder: 'asc' | 'desc';
	/**
	 * The exact number of keyset tuple values `payload.values` must carry —
	 * `getViewerPagesSortSpec(sortBy, sortOrder).columns.length`. Without this
	 * check a `values` array of the wrong length (a hand-crafted or corrupted
	 * cursor that still happens to pass the filterKey/sortBy/sortOrder checks)
	 * would reach `applyKeysetPredicate`'s positional column/value zip and
	 * build a malformed `(a, b, c) > (?, ?)`-shaped SQL comparison, surfacing
	 * as an opaque SQLite error instead of a clear cursor-validation error.
	 */
	expectedValueCount: number;
}

/**
 * Decodes and validates an opaque cursor against the caller's current
 * filters/sort. Rejects cursors minted under a different schema version or a
 * different effective filter/sort combination — replaying a cursor across a
 * changed query would silently seek to a nonsensical position.
 * @param cursor - The opaque cursor string from the request.
 * @param expected - The current request's filter key + sort, to validate against.
 * @returns The decoded, validated payload.
 * @throws {Error} If the cursor is malformed, stale, or was minted under a
 *   different filter/sort combination.
 */
export function decodeViewerPagesCursor(
	cursor: string,
	expected: ExpectedViewerPagesCursor,
): ViewerPagesCursorPayload {
	let payload: ViewerPagesCursorPayload;
	try {
		payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
	} catch {
		throw new Error('Invalid /api/pages cursor: not decodable');
	}
	if (
		typeof payload !== 'object' ||
		payload === null ||
		!Array.isArray(payload.values) ||
		typeof payload.filterKey !== 'string' ||
		typeof payload.v !== 'number'
	) {
		throw new Error('Invalid /api/pages cursor: malformed payload');
	}
	if (payload.v !== VIEWER_READ_MODEL_SCHEMA_VERSION) {
		throw new Error(
			'Stale /api/pages cursor: read-model schema has changed since it was issued',
		);
	}
	if (
		payload.filterKey !== expected.filterKey ||
		payload.sortBy !== expected.sortBy ||
		payload.sortOrder !== expected.sortOrder
	) {
		throw new Error(
			'Invalid /api/pages cursor: does not match the current filter/sort combination',
		);
	}
	if (payload.values.length !== expected.expectedValueCount) {
		throw new Error('Invalid /api/pages cursor: unexpected keyset value count');
	}
	return payload;
}
