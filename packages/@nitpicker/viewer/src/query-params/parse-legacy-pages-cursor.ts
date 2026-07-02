/**
 * Parses the `cursor` query param for `/api/pages`'s legacy (offset-based)
 * fallback path into the row offset to read from.
 *
 * The legacy path (`listPages`) has no keyset concept, so its `nextCursor`/
 * `prevCursor` are plain decimal offset strings rather than the fast path's
 * opaque base64 tokens (see `buildLegacyPagesCursors`) — this function is
 * their inverse. Missing, non-numeric, or negative values fall back to
 * `fallbackOffset` rather than throwing: an offset is just a starting point
 * for a `LIMIT`/`OFFSET` read, so a garbage cursor degrades to "start over"
 * instead of a hard error.
 * @param cursor - The raw `cursor` query-string value, or `undefined`.
 * @param fallbackOffset - The offset to use when `cursor` is absent or invalid.
 * @returns A non-negative integer offset.
 */
export function parseLegacyPagesCursor(
	cursor: string | undefined,
	fallbackOffset: number,
): number {
	if (!cursor) {
		return fallbackOffset;
	}
	const parsed = Number(cursor);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallbackOffset;
}
