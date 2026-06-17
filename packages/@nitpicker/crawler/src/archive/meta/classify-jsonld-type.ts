import type { JsonLdEntry } from '@d-zero/beholder';

/**
 * Extracts the top-level `@type` from a parsed {@link JsonLdEntry}, normalised
 * to a single string suitable for an indexed SQL column.
 *
 * JSON-LD `@type` has four shapes in the wild:
 *
 * - **String** — common single-type case (e.g. `"Product"`).
 * - **Array** — multi-type entries (e.g. `["Product", "Offer"]`). The first
 *   element is taken; the rest are recoverable from `parsed`.
 * - **Missing** — top-level object without an `@type` (often a `@graph`
 *   wrapper). Returns `null` so the column is filterable but does not over-
 *   fit a single type.
 * - **Parse error** — `parsed === undefined` because beholder set
 *   `parseError`. Returns `null`.
 *
 * `@graph` entries deliberately return `null` rather than `'@graph'` — a
 * graph is a container, not a type, and consumers grouping by `@type` would
 * see noise.
 * @param entry - One JSON-LD entry as captured by beholder.
 * @returns The normalised `@type` string, or `null` when not extractable.
 */
export function classifyJsonLdType(entry: JsonLdEntry): string | null {
	if (entry.parsed === undefined || entry.parsed === null) return null;
	if (typeof entry.parsed !== 'object') return null;
	const obj = entry.parsed as Record<string, unknown>;
	const rawType = obj['@type'];
	if (typeof rawType === 'string') {
		const trimmed = rawType.trim();
		return trimmed === '' ? null : trimmed;
	}
	if (Array.isArray(rawType)) {
		for (const t of rawType) {
			if (typeof t === 'string') {
				const trimmed = t.trim();
				if (trimmed !== '') return trimmed;
			}
		}
	}
	return null;
}
