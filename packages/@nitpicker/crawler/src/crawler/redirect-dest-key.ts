import type { ExURL } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import { protocolAgnosticKey } from './protocol-agnostic-key.js';

/**
 * Computes the protocol-agnostic dedup key for the final destination a request
 * lands on after following its redirect chain.
 *
 * Used by the redirect-convergence optimisation (#73): the crawler remembers
 * which final destinations have already been rendered, keyed by this value, so
 * that many source URLs all redirecting to one destination render it only once.
 * When there is no redirect, the destination is the requested URL itself.
 *
 * The key matches the form used elsewhere in the crawler (`protocolAgnosticKey`
 * over the normalised URL without hash/auth) so HTTP and HTTPS variants of the
 * same destination collapse to one entry.
 * @param url - The originally requested URL.
 * @param redirectPaths - The redirect hop URLs captured during the HEAD
 *   pre-flight, in order. The last entry is the final destination.
 * @returns The protocol-agnostic key of the final destination.
 */
export function redirectDestKey(url: ExURL, redirectPaths: readonly string[]): string {
	const last = redirectPaths.at(-1);
	if (last === undefined) {
		return protocolAgnosticKey(url.withoutHashAndAuth);
	}
	const parsed = parseUrl(last);
	return protocolAgnosticKey(parsed ? parsed.withoutHashAndAuth : last);
}
