import type { HeaderPresence } from './types.js';

/**
 * Mapping from public {@link HeaderPresence} keys to the corresponding
 * pre-computed boolean column in `header_flags` (Phase 6-A). Populated during
 * Phase 6-B by `packages/@nitpicker/crawler/src/archive/phase6b/compute-header-flags.ts`,
 * which mirrors the same detection rules the old LIKE-based
 * `pages.responseHeaders` scan used before Phase 6-F.
 */
const HEADER_FLAG_COLUMN: Record<keyof HeaderPresence, string> = {
	hasCSP: 'has_csp',
	hasXFrameOptions: 'has_x_frame_options',
	hasXContentTypeOptions: 'has_x_content_type_options',
	hasHSTS: 'has_hsts',
};

/**
 * The four {@link HeaderPresence} keys, in a stable order. Single source of
 * truth for every caller that needs to iterate the tracked headers (SQL
 * column builders, filter loops, viewer UI controls).
 */
export const HEADER_PRESENCE_KEYS = Object.keys(
	HEADER_FLAG_COLUMN,
) as (keyof HeaderPresence)[];

/**
 * Builds the SQL boolean expression (0 or 1) for whether a tracked security
 * header is present, by reading the Phase 6-A `header_flags` pre-computed
 * bool column. `coalesce(..., 0)` handles rows without a `header_set_id` (no
 * response headers captured — e.g. not-yet-scraped or redirect placeholder pages);
 * treating flag as 0 matches the pre-Phase-6 LIKE-based behaviour that
 * returned 0 when `pages.responseHeaders` was NULL.
 * @param key - Header presence field to evaluate.
 * @param flagsAlias - table alias used for `header_flags` in the surrounding
 *   query (callers add `.leftJoin('header_flags as <alias>', ...)` before
 *   invoking this).
 * @returns A SQL expression string suitable for `select`/`whereRaw`.
 */
export function headerPresenceExpression(
	key: keyof HeaderPresence,
	flagsAlias: string,
): string {
	return `coalesce("${flagsAlias}"."${HEADER_FLAG_COLUMN[key]}", 0)`;
}
