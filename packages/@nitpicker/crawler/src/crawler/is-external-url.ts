import type { ExURL } from '@d-zero/shared/parse-url';

/**
 * Determine whether a URL is external to the crawl scope.
 *
 * A URL is considered external if its hostname does not appear
 * as a key in the scope map.
 * @param url - The parsed URL to check.
 * @param scope - Map of hostnames to their scope URLs.
 * @returns `true` if the URL is outside the crawl scope.
 */
export function isExternalUrl(
	url: ExURL,
	scope: ReadonlyMap<string, readonly ExURL[]>,
): boolean {
	return !scope.has(url.hostname);
}
