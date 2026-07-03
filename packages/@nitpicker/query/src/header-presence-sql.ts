import type { HeaderPresence } from './types.js';

/**
 * SQL `LIKE` patterns for each tracked header, matched against the
 * lower-cased `pages.responseHeaders` JSON blob. Patterns require the
 * quote + colon that only appears around a JSON **key** (e.g.
 * `"content-security-policy":`) — a plain substring match would also fire
 * on a header whose *value* happens to mention another header's name (e.g.
 * a Referrer-Policy value describing a CSP), which the JSON-key-shaped
 * pattern excludes.
 */
const HEADER_LIKE_PATTERNS: Record<keyof HeaderPresence, string> = {
	hasCSP: '%"content-security-policy":%',
	hasXFrameOptions: '%"x-frame-options":%',
	hasXContentTypeOptions: '%"x-content-type-options":%',
	hasHSTS: '%"strict-transport-security":%',
};

/**
 * The four {@link HeaderPresence} keys, in a stable order. Single source of
 * truth for every caller that needs to iterate the tracked headers (SQL
 * column builders, filter loops, viewer UI controls) — derived from
 * {@link HEADER_LIKE_PATTERNS} so adding a header here is the only edit
 * needed to make it flow through automatically.
 */
export const HEADER_PRESENCE_KEYS = Object.keys(
	HEADER_LIKE_PATTERNS,
) as (keyof HeaderPresence)[];

/**
 * Builds the SQL boolean expression (0 or 1) for whether a tracked security
 * header is present on `pages.responseHeaders`. Never parses JSON — a
 * `LIKE` scan of the raw text, so it tolerates malformed or non-object
 * stored values (e.g. the literal text `null`) without throwing, and never
 * requires transferring the full blob to the application layer.
 * @param key - Header presence field to evaluate.
 * @returns A SQL `CASE WHEN ... THEN 1 ELSE 0 END` expression string.
 */
export function headerPresenceExpression(key: keyof HeaderPresence): string {
	return `case when lower(coalesce("pages"."responseHeaders", '')) like '${HEADER_LIKE_PATTERNS[key]}' then 1 else 0 end`;
}
