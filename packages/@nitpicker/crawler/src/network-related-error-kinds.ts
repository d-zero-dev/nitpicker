import type { ErrorKind } from './types.js';

/**
 * `ErrorKind`s that plausibly indicate trouble with the operator's own
 * network path rather than a genuinely dead or misconfigured target site.
 *
 * Single source of truth shared by two consumers that must agree on
 * exactly the same set:
 *
 * - `NetworkOutageDetector` — only these kinds contribute to the sliding
 *   window that detects a suspect outage.
 * - `evict-network-classified-destination-cache-entries.ts` — on recovery,
 *   only `destinationCache` entries whose cached `Error` classifies into
 *   one of these kinds are evicted (a cached `tls` or `client-blocked`
 *   failure is a site-specific fact and must survive an outage recovery
 *   unrelated to it).
 *
 * `dns` is included despite `permanent-error-kinds.ts` treating it as a
 * permanent, site-specific verdict in isolation — that classification is
 * exactly what outage detection exists to override when the surrounding
 * evidence (many hosts, tight time window) points to the local network
 * instead.
 */
export const NETWORK_RELATED_ERROR_KINDS: ReadonlySet<ErrorKind> = new Set<ErrorKind>([
	'dns',
	'dns-transient',
	'local-network',
	'connection-timeout',
	'connection-reset',
]);
