/** Every `/api/headers` `sortBy` value the query layer accepts. */
const HEADER_CHECKS_SORT_BY_VALUES = [
	'url',
	'hasCSP',
	'hasXFrameOptions',
	'hasXContentTypeOptions',
	'hasHSTS',
] as const;

/** A validated `/api/headers` sort field. */
export type HeaderChecksSortBy = (typeof HEADER_CHECKS_SORT_BY_VALUES)[number];

/**
 * Parses a raw query-string value into a {@link HeaderChecksSortBy}.
 *
 * Returns `undefined` for missing or unrecognised values — an unvalidated
 * `as`-cast here would let `?sortBy=bogus` flow into
 * `getHeaderChecksSortSpec`, whose header-flag column lookup would resolve
 * to `undefined` and produce a `no such column: undefined` SQLite error
 * (an opaque 500) instead of degrading to the default sort.
 * @param raw - The raw query-string value.
 * @returns The narrowed sort field or `undefined`.
 */
export function toHeaderChecksSortBy(
	raw: string | undefined,
): HeaderChecksSortBy | undefined {
	if (!raw) {
		return undefined;
	}
	return (HEADER_CHECKS_SORT_BY_VALUES as readonly string[]).includes(raw)
		? (raw as HeaderChecksSortBy)
		: undefined;
}
