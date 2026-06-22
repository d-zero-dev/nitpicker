import type { ErrorKind } from '../types.js';

/**
 * Inputs to {@link shouldBurnHost}.
 */
export interface ShouldBurnHostParams {
	/**
	 * The {@link ErrorKind} classified from the final-attempt error message
	 * (i.e. the error that ended the retry loop in `Crawler.#sendHeadRequest`'s
	 * `onGiveUp`).
	 */
	errorKind: ErrorKind;

	/**
	 * Lower-cased hostname whose URL just exhausted retries. Must already be
	 * normalised by the caller — `dnsBurnedHostCache` keys are
	 * `url.hostname.toLowerCase()`, so this guard reuses that exact form to
	 * stay consistent across the two sites.
	 */
	host: string;

	/**
	 * Set of hostnames that have had at least one successful
	 * `fetchDestination` response in this session. `ReadonlySet` because the
	 * decision is read-only — populating the set is the caller's job.
	 */
	successfulHosts: ReadonlySet<string>;
}

/**
 * Burn the host iff the final-attempt kind is `'dns'` AND the host has no
 * session-success record. Pure function — unit-testable in isolation from
 * the `Crawler` instance, the in-memory caches, and the dealer's retry
 * plumbing.
 *
 * **Why the session-success gate exists**: the first worker to exhaust
 * retries with `getaddrinfo ENOTFOUND` would otherwise burn the host and
 * make every subsequent URL on it short-circuit immediately via
 * `PreloadShortCircuitError`, draining the dealer's work queue in seconds
 * and collapsing the crawl into a degenerate `crawlEnd`. When the cause is
 * a local-network blip (operator's WiFi → tethering / VPN flip / ISP DNS
 * hiccup mid-crawl) rather than a dead domain, the host was demonstrably
 * alive moments earlier — earlier successes on it are recorded in
 * `successfulHosts`, so the cascade is suppressed.
 *
 * **Why `'dns-transient'` is excluded**: `EAI_AGAIN` / `EREFUSED` are
 * absorbed by the retry layer within the session; a final-attempt
 * `'dns-transient'` is rare enough that we'd rather pay the per-URL retry
 * cost than wrongly fast-fail a healthy host that flapped briefly. Only the
 * stronger `'dns'` kind is a candidate for burning.
 *
 * **Known limitation — first-URL false positives**: a host whose very first
 * URL of the session hits a real network blip exhausts its retry budget
 * before any URL has succeeded, so `successfulHosts` is still empty and the
 * host IS burned. That URL's siblings on the same host then short-circuit.
 * Acceptable trade-off: the alternative ("never burn anything") regresses
 * the dead-domain fast-fail behavior that the burn cache exists for. The
 * pause-dealer-on-outage layer (separate issue) covers this gap by
 * detecting the outage BEFORE the first retry budget runs out.
 *
 * **Known limitation — preload-seeded burns are not un-burned**: a host
 * added by `#preloadDnsBurnedHostCache` from the archive's `crawl_errors`
 * trips `PreloadShortCircuitError` at the top of `#sendHeadRequest` and
 * never reaches `fetchDestination`, so `successfulHosts` is never
 * populated for it in this session. This is intentional — preload only
 * seeds hosts whose archive evidence is "DNS-failed with no recovery", so
 * un-burning them on a single transient success could re-introduce the
 * cascade we are trying to prevent.
 *
 * **What does NOT contribute to `successfulHosts`**: external pages
 * traversed via `fetchExternal: false` skip the HEAD pre-flight entirely
 * (the crawler stamps a synthetic `PageData` without touching the
 * network), so the host is not recorded as alive even if the same host
 * appears in the crawled-internal scope. Callers must populate the set
 * from real HTTP-response observations only.
 * @param params - See {@link ShouldBurnHostParams}.
 * @param params.errorKind
 * @param params.host
 * @param params.successfulHosts
 * @returns `true` if the burn cache should record this host, `false` otherwise.
 */
export function shouldBurnHost({
	errorKind,
	host,
	successfulHosts,
}: ShouldBurnHostParams): boolean {
	if (errorKind !== 'dns') {
		return false;
	}
	if (successfulHosts.has(host)) {
		return false;
	}
	return true;
}
