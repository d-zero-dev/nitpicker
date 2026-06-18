/**
 * Thrown by `Crawler.#sendHeadRequest` when the target URL's hostname is in
 * `dnsBurnedHostCache` — both session-learned and preload-seeded burns
 * land here.
 *
 * The orchestrator's `crawler.on('error', …)` handler tests `instanceof` and
 * skips writing this error to `crawl_errors` / `error.log`, so the same
 * preload data isn't re-amplified on subsequent crawls. `pages.status = -1`
 * still gets set through the normal scrape-error path.
 *
 * The message embeds the `ENOTFOUND` token so any downstream consumer that
 * runs `classifyErrorKind` over it (e.g. dealer log forwarders) still gets
 * the `'dns'` classification.
 */
export class PreloadShortCircuitError extends Error {
	/** Sniffable flag for callers that prefer duck-typing over instanceof. */
	readonly isPreloadShortCircuit = true as const;

	/**
	 * @param host - The DNS-burned hostname (already lowercased / Punycoded).
	 */
	constructor(host: string) {
		super(`getaddrinfo ENOTFOUND ${host}`);
		this.name = 'PreloadShortCircuitError';
	}
}
