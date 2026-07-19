/** A validated sort direction. */
export type PageSortOrder = 'asc' | 'desc';

/**
 * Parses a raw query-string value into a {@link PageSortOrder}.
 *
 * Returns `undefined` for missing or unrecognised values — see
 * {@link toPageSortBy}'s docs for why unvalidated sort values are
 * specifically risky on the `viewer_pages` cursor fast path.
 * @param raw - The raw query-string value.
 * @returns `'asc'`/`'desc'`, or `undefined`.
 */
export function toPageSortOrder(raw: string | undefined): PageSortOrder | undefined {
	if (raw === 'asc' || raw === 'desc') {
		return raw;
	}
	return undefined;
}
