/** Every `/api/resources` `sortBy` value the `viewer_resources` fast path serves — the full `ListResourcesOptions.sortBy` surface. */
const RESOURCES_SORT_BY_VALUES = [
	'url',
	'status',
	'statusText',
	'contentType',
	'contentLength',
	'isExternal',
	'referrerCount',
	'compress',
	'cdn',
] as const;

/** A validated fast-path `/api/resources` sort field. */
export type ResourcesSortBy = (typeof RESOURCES_SORT_BY_VALUES)[number];

/**
 * Parses a raw query-string value into a {@link ResourcesSortBy}.
 *
 * Returns `undefined` for missing or unrecognised values — callers must
 * check the RAW `sortBy` string themselves (against the same value set this
 * function validates against) to decide whether to fall back to
 * `listResources` (which supports a wider `sortBy` set); this parser is
 * only safe to call once that fast-path-eligibility decision has already
 * been made, same ordering requirement as `toPageSortBy`'s cursor-identity
 * note.
 * @param raw - The raw query-string value.
 * @returns The narrowed sort field or `undefined`.
 */
export function toResourcesSortBy(raw: string | undefined): ResourcesSortBy | undefined {
	if (!raw) {
		return undefined;
	}
	return (RESOURCES_SORT_BY_VALUES as readonly string[]).includes(raw)
		? (raw as ResourcesSortBy)
		: undefined;
}
