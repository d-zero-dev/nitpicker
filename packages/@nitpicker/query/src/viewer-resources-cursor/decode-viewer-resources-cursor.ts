import type { ViewerResourcesCursorPayload } from './types.js';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

/**
 * The current request's identity to validate a decoded `/api/resources`
 * cursor against.
 */
export interface ExpectedViewerResourcesCursor {
	/** See `buildViewerResourcesFilterKey`. */
	filterKey: string;
	/** The current request's sort field. */
	sortBy: 'url' | 'status';
	/** The current request's sort direction. */
	sortOrder: 'asc' | 'desc';
	/**
	 * The exact number of keyset tuple values `payload.values` must carry —
	 * `getViewerResourcesSortSpec(sortBy, sortOrder).columns.length`. Without
	 * this check a `values` array of the wrong length would reach the keyset
	 * predicate's positional column/value zip and build a malformed SQL
	 * comparison, surfacing as an opaque SQLite error instead of a clear
	 * cursor-validation error.
	 */
	expectedValueCount: number;
}

/**
 * Decodes and validates an opaque `/api/resources` cursor against the
 * caller's current filters/sort. Rejects cursors minted under a different
 * schema version or a different effective filter/sort combination —
 * replaying a cursor across a changed query would silently seek to a
 * nonsensical position.
 * @param cursor - The opaque cursor string from the request.
 * @param expected - The current request's filter key + sort, to validate against.
 * @returns The decoded, validated payload.
 * @throws {Error} If the cursor is malformed, stale, or was minted under a
 *   different filter/sort combination.
 */
export function decodeViewerResourcesCursor(
	cursor: string,
	expected: ExpectedViewerResourcesCursor,
): ViewerResourcesCursorPayload {
	let payload: ViewerResourcesCursorPayload;
	try {
		payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
	} catch {
		throw new Error('Invalid /api/resources cursor: not decodable');
	}
	if (
		typeof payload !== 'object' ||
		payload === null ||
		!Array.isArray(payload.values) ||
		typeof payload.filterKey !== 'string' ||
		typeof payload.v !== 'number'
	) {
		throw new Error('Invalid /api/resources cursor: malformed payload');
	}
	if (payload.v !== VIEWER_READ_MODEL_SCHEMA_VERSION) {
		throw new Error(
			'Stale /api/resources cursor: read-model schema has changed since it was issued',
		);
	}
	if (
		payload.filterKey !== expected.filterKey ||
		payload.sortBy !== expected.sortBy ||
		payload.sortOrder !== expected.sortOrder
	) {
		throw new Error(
			'Invalid /api/resources cursor: does not match the current filter/sort combination',
		);
	}
	if (payload.values.length !== expected.expectedValueCount) {
		throw new Error('Invalid /api/resources cursor: unexpected keyset value count');
	}
	return payload;
}
