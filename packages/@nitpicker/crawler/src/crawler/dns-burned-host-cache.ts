import type { ErrorKind } from '../types.js';

/**
 * In-memory set of hostnames known to be unreachable due to DNS errors
 * (e.g. `getaddrinfo ENOTFOUND`).
 *
 * Lives for one crawl session — cleared by {@link clearDnsBurnedHostCache} at
 * the same four orchestrator sites as {@link destinationCache}. Hosts are
 * marked in two ways:
 *
 * - **Session learning**: the `onGiveUp` callback of `#sendHeadRequest`
 *   classifies the final retry error and stores `'dns'` when the matcher
 *   fires. The next URL on the same hostname short-circuits before retry.
 * - **Session preload**: re-open paths (`append` / `inventory` / `retryFailed`
 *   / `resume`) call {@link Archive.listDnsBurnedHostCandidates} and seed the
 *   map from `crawl_errors`, so previously-burned hosts cost zero retries on
 *   the next crawl.
 *
 * Keys are always `url.hostname.toLowerCase()` — WHATWG URL has already
 * Punycoded IDNs and stripped the port, so no extra normalization is needed
 * for IPv4 / IPv6 literals or international hostnames.
 *
 * The value records the originating {@link ErrorKind}. Only `'dns'` is set
 * today; the union shape is preserved so future error classes
 * (e.g. `tls`, `connection-refused`) can extend the same cache.
 */
export const dnsBurnedHostCache = new Map<string, ErrorKind>();
