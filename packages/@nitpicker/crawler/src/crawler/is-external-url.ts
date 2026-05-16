import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';

import { findScopeEntry } from './find-scope-entry.js';

/**
 * Determine whether a URL is external to the crawl scope.
 *
 * A URL is external when no scope entry contains it — i.e. either no scope
 * entry shares its hostname, or none of the same-hostname scope entries is at
 * the same level or shallower in the path hierarchy.
 *
 * This is a thin wrapper around {@link findScopeEntry}. Callers that already
 * need the matched scope (for `injectScopeAuth` etc.) should call
 * `findScopeEntry` directly instead of `isExternalUrl` to avoid a redundant
 * lookup.
 * @param url - The parsed URL to check.
 * @param scope - Hostname-indexed map of scope URLs.
 * @param options - URL parsing options forwarded to the scope-entry lookup.
 * @returns `true` if the URL is outside every scope entry.
 */
export function isExternalUrl(
	url: ExURL,
	scope: ReadonlyMap<string, readonly ExURL[]>,
	options?: ParseURLOptions,
): boolean {
	return findScopeEntry(url, scope, options) === null;
}
