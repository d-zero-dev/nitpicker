import type { PageData } from '@d-zero/beholder';

import { classifyErrorKind } from '../classify-error-kind.js';
import { NETWORK_RELATED_ERROR_KINDS } from '../network-related-error-kinds.js';

/**
 * Delete every `destinationCache` entry whose cached value is an `Error`
 * that classifies as a {@link NETWORK_RELATED_ERROR_KINDS network-related}
 * kind, leaving successes and site-specific failures (`tls`,
 * `client-blocked`, `connection-refused`, …) untouched.
 *
 * Called by `Crawler` whenever its network gate transitions from closed to
 * open (whether via a successful recovery probe or an abort), so a URL
 * that failed with `getaddrinfo ENOTFOUND` only because the operator's own
 * network was down does not stay wrongly cached as "this host is dead" for
 * the rest of the session.
 *
 * Deliberately does NOT distinguish "cached during THIS specific outage"
 * from "cached during an earlier blip this session" — any cached error
 * whose KIND looks network-related is, by definition, potentially stale
 * evidence about the operator's network rather than the target site, so it
 * is always safe to re-test after any recovery. The trade-off is a few
 * redundant HEAD attempts for hosts that were already dead independent of
 * the outage; the alternative (a stale "outage-tainted" failure verdict
 * surviving the rest of the session) is strictly worse.
 * @param cache - The cache to sweep. Takes the `Map` explicitly (rather
 *   than importing the `destinationCache` singleton directly) so this stays
 *   unit-testable without touching module-level state.
 */
export function evictNetworkClassifiedDestinationCacheEntries(
	cache: Map<string, PageData | Error>,
): void {
	for (const [key, value] of cache) {
		if (
			value instanceof Error &&
			NETWORK_RELATED_ERROR_KINDS.has(classifyErrorKind(value.message))
		) {
			cache.delete(key);
		}
	}
}
