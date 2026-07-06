import type { ViewerImagesCursorPayload } from './types.js';

import { decodeCursorEnvelope } from '../viewer-cursor-kit/decode-cursor-envelope.js';

/**
 * The current request's identity to validate a decoded `/api/images` cursor
 * against.
 */
export interface ExpectedViewerImagesCursor {
	/** See `buildViewerImagesFilterKey`. */
	filterKey: string;
	/** The current request's sort field. */
	sortBy: ViewerImagesCursorPayload['sortBy'];
	/** The current request's sort direction. */
	sortOrder: 'asc' | 'desc';
	/**
	 * The exact number of keyset tuple values `payload.values` must carry —
	 * `getViewerImagesSortSpec(sortBy, sortOrder).columns.length`. Without
	 * this check a `values` array of the wrong length would reach the keyset
	 * predicate's positional column/value zip and build a malformed SQL
	 * comparison, surfacing as an opaque SQLite error instead of a clear
	 * cursor-validation error.
	 */
	expectedValueCount: number;
}

/**
 * Decodes and validates an opaque `/api/images` cursor against the caller's
 * current filters/sort. Rejects cursors minted under a different schema
 * version or a different effective filter/sort combination — replaying a
 * cursor across a changed query would silently seek to a nonsensical
 * position. Thin wrapper over the shared {@link decodeCursorEnvelope}.
 * @param cursor - The opaque cursor string from the request.
 * @param expected - The current request's filter key + sort, to validate against.
 * @returns The decoded, validated payload.
 * @throws {Error} If the cursor is malformed, stale, or was minted under a
 *   different filter/sort combination.
 */
export function decodeViewerImagesCursor(
	cursor: string,
	expected: ExpectedViewerImagesCursor,
): ViewerImagesCursorPayload {
	return decodeCursorEnvelope(cursor, expected, '/api/images');
}
