import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';

import { isLowerLayer } from '@d-zero/shared/is-lower-layer';

/**
 * Find the most-specific scope entry that contains the given URL.
 *
 * A scope entry is an `(hostname, port, path)` triple. The target URL belongs
 * to a scope entry when its hostname AND port match and its path is at the
 * same level or deeper than the scope entry's path. Among all matching entries,
 * the one with the greatest depth wins (e.g. `/blog/2024/` is preferred over
 * `/blog/`). Port comparison uses the WHATWG-normalized `port` field, so
 * default ports (`80` for http, `443` for https) collapse to an empty string
 * and match each other regardless of whether the user wrote them explicitly.
 * A non-default port like `:3000` only matches scope entries that also carry
 * the same port — this prevents credentialed dev sites (`localhost:3000`)
 * from leaking auth into siblings on the same hostname (`localhost:8080`).
 *
 * Returns `null` if no scope entry contains the URL — i.e. the URL is external.
 * This single function replaces the previous trio of `isExternalUrl`,
 * `isInAnyLowerLayer`, and `findBestMatchingScope`, performing a single
 * hostname lookup and a single pass over the scope array.
 * @param url - The target URL to classify.
 * @param scope - Hostname-indexed map of scope URLs.
 * @param options - URL parsing options forwarded to {@link isLowerLayer}.
 * @returns The deepest matching scope URL, or `null` when the URL is external.
 */
export function findScopeEntry(
	url: ExURL,
	scope: ReadonlyMap<string, readonly ExURL[]>,
	options?: ParseURLOptions,
): ExURL | null {
	const scopes = scope.get(url.hostname);
	if (!scopes) {
		return null;
	}
	let bestMatch: ExURL | null = null;
	let maxDepth = -1;
	for (const entry of scopes) {
		if (entry.port !== url.port) {
			continue;
		}
		if (!isLowerLayer(url, entry, options)) {
			continue;
		}
		if (entry.depth > maxDepth) {
			bestMatch = entry;
			maxDepth = entry.depth;
		}
	}
	return bestMatch;
}
