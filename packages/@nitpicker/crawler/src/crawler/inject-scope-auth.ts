import type { ExURL } from '@d-zero/shared/parse-url';

import { findBestMatchingScope } from './find-best-matching-scope.js';

/**
 * Inject authentication credentials from a matching scope URL into the target URL.
 *
 * Finds the best-matching scope URL (deepest path match) for the given URL's
 * hostname and copies its `username` and `password` properties. This mutates
 * the `url` parameter in place.
 * @param url - The parsed URL to receive authentication credentials (mutated in place).
 * @param scope - Map of hostnames to their scope URLs.
 */
export function injectScopeAuth(
	url: ExURL,
	scope: ReadonlyMap<string, readonly ExURL[]>,
): void {
	const scopes = scope.get(url.hostname);
	if (!scopes) {
		return;
	}
	const matchedScope = findBestMatchingScope(url, scopes);
	if (matchedScope) {
		url.username = matchedScope.username;
		url.password = matchedScope.password;
	}
}
