import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

/**
 * Builds a hostname-indexed scope map from a list of root URL strings, for
 * use with {@link findScopeEntry}.
 *
 * Each root that fails to parse is silently skipped (a malformed root can
 * never match anything anyway) rather than throwing, matching the existing
 * inline construction this replaces (`crawler-orchestrator.ts`'s `append`
 * and inventory-classification call sites, `Crawler`'s own scope build).
 * Roots sharing a hostname are grouped under one array entry so
 * `findScopeEntry` can pick the most specific match among them.
 * @param roots - Root URL strings (e.g. `Config.roots`).
 * @param options - URL parsing options forwarded to {@link parseUrl}.
 * @returns A hostname-indexed map of parsed root URLs.
 * @example
 * ```ts
 * const scope = buildScopeMap(['https://example.com/blog/', 'https://example.com/docs/']);
 * findScopeEntry(url, scope); // deepest matching root, or null if external
 * ```
 */
export function buildScopeMap(
	roots: readonly string[],
	options?: ParseURLOptions,
): Map<string, ExURL[]> {
	const scope = new Map<string, ExURL[]>();
	for (const raw of roots) {
		const parsed = parseUrl(raw, options);
		if (!parsed) {
			continue;
		}
		const existing = scope.get(parsed.hostname) ?? [];
		scope.set(parsed.hostname, [...existing, parsed]);
	}
	return scope;
}
