import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';

import { pathMatch } from '@d-zero/shared/path-match';

import { protocolAgnosticKey } from './protocol-agnostic-key.js';

/**
 * Parameters for {@link shouldSkipUrl}.
 */
export interface ShouldSkipUrlParams {
	/** The parsed URL to check. */
	readonly url: ExURL;
	/** Array of glob patterns for URLs to exclude. */
	readonly excludes: readonly string[];
	/** Array of URL prefixes to exclude (matched via `startsWith`). */
	readonly excludeUrls: readonly string[];
	/** URL parsing options used for pattern matching. */
	readonly options: ParseURLOptions;
}

/**
 * Determine whether a URL should be skipped during crawling.
 *
 * A URL is skipped if it matches any user-defined exclude glob pattern
 * or starts with any of the excluded URL prefixes.
 * @param params - Parameters containing the URL, exclude patterns, and options.
 * @returns `true` if the URL should be skipped.
 */
export function shouldSkipUrl(params: ShouldSkipUrlParams): boolean {
	const { url, excludes, excludeUrls, options } = params;
	return (
		excludes.some((excludeGlobPattern) => pathMatch(url, excludeGlobPattern, options)) ||
		excludeUrls.some((prefix) =>
			protocolAgnosticKey(url.href).startsWith(protocolAgnosticKey(prefix)),
		)
	);
}
