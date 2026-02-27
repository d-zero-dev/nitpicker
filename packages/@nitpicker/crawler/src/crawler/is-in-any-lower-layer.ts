import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';

import { isLowerLayer } from '@d-zero/shared/is-lower-layer';

/**
 * Check whether a URL is in a lower layer (subdirectory) of any scope URL.
 *
 * Tests the URL against each scope URL using the `isLowerLayer` utility,
 * which checks if the URL's path is at the same level or deeper than
 * the scope URL's path.
 * @param url - The parsed URL to check.
 * @param scopes - The list of scope URLs to test against.
 * @param options - URL parsing options used for layer comparison.
 * @returns `true` if the URL is in a lower layer of at least one scope URL.
 */
export function isInAnyLowerLayer(
	url: ExURL,
	scopes: readonly ExURL[],
	options: ParseURLOptions,
): boolean {
	return scopes.some((scope) => isLowerLayer(url.href, scope.href, options));
}
