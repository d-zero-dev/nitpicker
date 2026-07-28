import type { ViewerPagesCursorPayload } from './types.js';

import { decodeCursorEnvelope } from '../viewer-cursor-kit/decode-cursor-envelope.js';

/**
 * The current request's identity to validate a decoded cursor against.
 */
export interface ExpectedViewerPagesCursor {
	/** See `buildViewerPagesFilterKey`. */
	filterKey: string;
	/** The current request's sort field. */
	sortBy:
		| 'url'
		| 'status'
		| 'title'
		| 'mainContentWordCount'
		| 'mainContentBodyWordCount'
		| 'mainContentHeadingCount'
		| 'mainContentImageCount'
		| 'mainContentTableCount'
		| 'mainContentButtonCount'
		| 'mainContentIframeCount'
		| 'mainContentVideoCount'
		| 'mainContentAudioCount'
		| 'mainContentCanvasCount'
		| 'scrollHeightDesktop'
		| 'scrollHeightMobile'
		| 'consoleErrorCount';
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
 * changed query would silently seek to a nonsensical position. Thin wrapper
 * over the shared {@link decodeCursorEnvelope}.
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
	return decodeCursorEnvelope(cursor, expected, '/api/pages');
}
