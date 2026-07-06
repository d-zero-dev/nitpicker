import type { CursorEnvelope, ExpectedCursorEnvelope } from './types.js';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

/**
 * Decodes and validates an opaque cursor against the caller's current
 * filters/sort. Rejects cursors minted under a different schema version or a
 * different effective filter/sort combination — replaying a cursor across a
 * changed query would silently seek to a nonsensical position. Shared by
 * every `viewer_*` table's keyset-cursor module.
 * @param cursor - The opaque cursor string from the request.
 * @param expected - The current request's filter key + sort, to validate against.
 * @param entityLabel - Human-readable label for error messages, e.g.
 *   `'/api/resources'` — purely cosmetic, does not affect validation.
 * @returns The decoded, validated payload.
 * @throws {Error} If the cursor is malformed, stale, or was minted under a
 *   different filter/sort combination.
 * @throws {TypeError} If `expectedValueTypeAt` is supplied and a value's
 *   runtime type does not match the expected type at its position.
 */
export function decodeCursorEnvelope<SortBy extends string>(
	cursor: string,
	expected: ExpectedCursorEnvelope<SortBy>,
	entityLabel: string,
): CursorEnvelope<SortBy> {
	let payload: CursorEnvelope<SortBy>;
	try {
		payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
	} catch {
		throw new Error(`Invalid ${entityLabel} cursor: not decodable`);
	}
	if (
		typeof payload !== 'object' ||
		payload === null ||
		!Array.isArray(payload.values) ||
		typeof payload.filterKey !== 'string' ||
		typeof payload.v !== 'number'
	) {
		throw new Error(`Invalid ${entityLabel} cursor: malformed payload`);
	}
	if (payload.v !== VIEWER_READ_MODEL_SCHEMA_VERSION) {
		throw new Error(
			`Stale ${entityLabel} cursor: read-model schema has changed since it was issued`,
		);
	}
	if (
		payload.filterKey !== expected.filterKey ||
		payload.sortBy !== expected.sortBy ||
		payload.sortOrder !== expected.sortOrder
	) {
		throw new Error(
			`Invalid ${entityLabel} cursor: does not match the current filter/sort combination`,
		);
	}
	if (payload.values.length !== expected.expectedValueCount) {
		throw new Error(`Invalid ${entityLabel} cursor: unexpected keyset value count`);
	}
	if (expected.expectedValueTypeAt) {
		for (const [index, value] of payload.values.entries()) {
			const expectedType = expected.expectedValueTypeAt(index);
			if (typeof value !== expectedType) {
				throw new TypeError(
					`Invalid ${entityLabel} cursor: value at position ${index} must be a ${expectedType}`,
				);
			}
		}
	}
	return payload;
}
