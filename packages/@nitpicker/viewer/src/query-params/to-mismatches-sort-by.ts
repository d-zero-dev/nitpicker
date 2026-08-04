/** Every `/api/mismatches` `sortBy` value the query layer accepts. */
const MISMATCHES_SORT_BY_VALUES = ['url', 'actual', 'expected'] as const;

/** A validated `/api/mismatches` sort field. */
export type MismatchesSortBy = (typeof MISMATCHES_SORT_BY_VALUES)[number];

/**
 * Parses a raw query-string value into a {@link MismatchesSortBy}.
 *
 * Returns `undefined` for missing or unrecognised values — an unvalidated
 * `as`-cast here would let `?sortBy=bogus` flow into
 * `getMismatchesSortSpec`'s exhaustive switch, fall out with no matching
 * case, and crash the request with an opaque 500 instead of degrading to
 * the default sort.
 * @param raw - The raw query-string value.
 * @returns The narrowed sort field or `undefined`.
 */
export function toMismatchesSortBy(
	raw: string | undefined,
): MismatchesSortBy | undefined {
	if (!raw) {
		return undefined;
	}
	return (MISMATCHES_SORT_BY_VALUES as readonly string[]).includes(raw)
		? (raw as MismatchesSortBy)
		: undefined;
}
