import type { AnchorFactsCursorPayload, AnchorFactsSortColumn } from './types.js';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

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
 * changed query would silently seek to a nonsensical position.
 * @param cursor - The opaque cursor string from the request.
 * @param expected - The current request's filter key + sort, to validate against.
 * @returns The decoded, validated payload.
 * @throws {Error} If the cursor is malformed, stale, or was minted under a
 *   different filter/sort combination.
 */
export function decodeAnchorFactsCursor(
	cursor: string,
	expected: ExpectedAnchorFactsCursor,
): AnchorFactsCursorPayload {
	let payload: AnchorFactsCursorPayload;
	try {
		payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
	} catch {
		throw new Error('Invalid /api/links?type=broken cursor: not decodable');
	}
	if (
		typeof payload !== 'object' ||
		payload === null ||
		!Array.isArray(payload.values) ||
		typeof payload.filterKey !== 'string' ||
		typeof payload.v !== 'number'
	) {
		throw new Error('Invalid /api/links?type=broken cursor: malformed payload');
	}
	if (payload.v !== VIEWER_READ_MODEL_SCHEMA_VERSION) {
		throw new Error(
			'Stale /api/links?type=broken cursor: read-model schema has changed since it was issued',
		);
	}
	if (
		payload.filterKey !== expected.filterKey ||
		payload.sortBy !== expected.sortBy ||
		payload.sortOrder !== expected.sortOrder
	) {
		throw new Error(
			'Invalid /api/links?type=broken cursor: does not match the current filter/sort combination',
		);
	}
	if (payload.values.length !== expected.columns.length) {
		throw new Error(
			'Invalid /api/links?type=broken cursor: unexpected keyset value count',
		);
	}
	for (const [i, column] of expected.columns.entries()) {
		const expectedType = isNumericAnchorFactsSortColumn(column) ? 'number' : 'string';
		if (typeof payload.values[i] !== expectedType) {
			throw new TypeError(
				`Invalid /api/links?type=broken cursor: value at position ${i} must be a ${expectedType}`,
			);
		}
	}
	return payload;
}
