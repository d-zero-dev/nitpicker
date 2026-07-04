import type { ExURL } from '@d-zero/shared/parse-url';

/**
 * Copy `username` / `password` from a matched scope URL into the target URL.
 *
 * The matched scope is supplied by the caller (typically the result of a single
 * `findScopeEntry` call). This avoids the previous implementation's
 * redundant hostname lookup and re-search.
 *
 * Mutates the `url` parameter in place. Only non-empty credentials overwrite
 * existing values.
 * @param url - The parsed URL to receive credentials (mutated in place).
 * @param matchedScope - The scope URL whose credentials should be inherited.
 */
export function injectScopeAuth(url: ExURL, matchedScope: ExURL): void {
	if (matchedScope.username) {
		url.username = matchedScope.username;
	}
	if (matchedScope.password) {
		url.password = matchedScope.password;
	}
}
