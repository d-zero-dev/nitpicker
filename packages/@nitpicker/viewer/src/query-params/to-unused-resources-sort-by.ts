/** Every `/api/unused-resources` `sortBy` value the `viewer_resources` fast path indexes. */
const UNUSED_RESOURCES_SORT_BY_VALUES = ['url', 'status', 'source'] as const;

/** A validated fast-path `/api/unused-resources` sort field. */
export type UnusedResourcesSortBy = (typeof UNUSED_RESOURCES_SORT_BY_VALUES)[number];

/**
 * Parses a raw query-string value into an {@link UnusedResourcesSortBy}.
 *
 * Returns `undefined` for missing or unrecognised values — callers must
 * check the RAW `sortBy` string themselves (against the same value set this
 * function validates against) to decide whether to fall back to
 * `listUnusedResources` (which supports a wider `sortBy` set); this parser
 * is only safe to call once that fast-path-eligibility decision has already
 * been made, same ordering requirement as `toPageSortBy`'s cursor-identity
 * note.
 * @param raw - The raw query-string value.
 * @returns The narrowed sort field or `undefined`.
 */
export function toUnusedResourcesSortBy(
	raw: string | undefined,
): UnusedResourcesSortBy | undefined {
	if (!raw) {
		return undefined;
	}
	return (UNUSED_RESOURCES_SORT_BY_VALUES as readonly string[]).includes(raw)
		? (raw as UnusedResourcesSortBy)
		: undefined;
}
