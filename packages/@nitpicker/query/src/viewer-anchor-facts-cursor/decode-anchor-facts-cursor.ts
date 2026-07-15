import type { AnchorFactsCursorPayload, AnchorFactsSortColumn } from './types.js';

import { decodeCursorEnvelope } from '../viewer-cursor-kit/decode-cursor-envelope.js';

import { isNumericAnchorFactsSortColumn } from './types.js';

/**
 * The current request's identity to validate a decoded cursor against.
 */
export interface ExpectedAnchorFactsCursor {
	/** See `buildAnchorFactsFilterKey`. */
	filterKey: string;
	/** The current request's sort field. */
	sortBy: 'sourceUrl' | 'destUrl' | 'status';
	/** The current request's sort direction. */
	sortOrder: 'asc' | 'desc';
	/**
	 * `getAnchorFactsSortSpec(sortBy, sortOrder).columns` — both the exact
	 * tuple length `payload.values` must carry, and the per-position type
	 * (`isNumericAnchorFactsSortColumn`) each value is checked against.
	 * Without the length check, a `values` array of the wrong length would
	 * reach the keyset predicate's positional column/value zip and build a
	 * malformed SQL comparison; without the per-position type check, a
	 * same-length but wrong-typed `values` array (e.g. a string standing in
	 * for `edge_id`) would silently seek to the wrong keyset boundary via
	 * SQLite's type-affinity comparison rules instead of erroring.
	 */
	columns: readonly AnchorFactsSortColumn[];
}

/**
 * Decodes and validates an opaque cursor against the caller's current
 * filters/sort. Rejects cursors minted under a different schema version or a
 * different effective filter/sort combination — replaying a cursor across a
 * changed query would silently seek to a nonsensical position. Thin wrapper
 * over the shared {@link decodeCursorEnvelope}, translating this table's
 * `columns`-shaped `expected` input into the generic
 * `expectedValueCount`/`expectedValueTypeAt` shape. Anchor fact cursors use
 * numeric URL ref ids plus numeric status/edge keys, so this opts into the
 * shared decoder's per-position type check to reject a wrong-typed `values`
 * array (e.g. a URL string where a numeric ref id belongs) clearly.
 * @param cursor - The opaque cursor string from the request.
 * @param expected - The current request's filter key + sort, to validate against.
 * @returns The decoded, validated payload.
 * @throws {Error} If the cursor is malformed, stale, or was minted under a
 *   different filter/sort combination.
 * @throws {TypeError} If a keyset value's runtime type doesn't match the
 *   column it stands for.
 */
export function decodeAnchorFactsCursor(
	cursor: string,
	expected: ExpectedAnchorFactsCursor,
): AnchorFactsCursorPayload {
	return decodeCursorEnvelope(
		cursor,
		{
			filterKey: expected.filterKey,
			sortBy: expected.sortBy,
			sortOrder: expected.sortOrder,
			expectedValueCount: expected.columns.length,
			expectedValueTypeAt: (index) =>
				isNumericAnchorFactsSortColumn(expected.columns[index]!) ? 'number' : 'string',
		},
		'/api/links?type=broken',
	);
}
