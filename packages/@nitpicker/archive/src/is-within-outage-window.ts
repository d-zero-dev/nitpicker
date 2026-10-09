/**
 * A resolved (closed) network-outage interval, as consumed by
 * {@link isWithinOutageWindow}.
 *
 * This is deliberately NOT the raw `network_outages` row shape: a row whose
 * `ended_at` is still `NULL` (the crawl session crashed before recovery was
 * observed) must be resolved to a concrete `endedAt` by the caller — e.g.
 * `listNetworkOutages` clamping it to the latest observed timestamp in the
 * archive — before it reaches this function. Accepting a nullable `endedAt`
 * here would let a crashed session's outage silently swallow every
 * subsequent timestamp as "network-caused" forever.
 */
export interface OutageWindow {
	/** Epoch ms the outage is considered to have started (already backdated to the earliest triggering error). */
	readonly startedAt: number;
	/** Epoch ms the outage is considered to have ended. Never `NULL` — see the interface docstring. */
	readonly endedAt: number;
}

/**
 * Decide whether a timestamp falls inside any recorded network-outage
 * window — i.e. whether an error observed at that instant is more likely
 * attributable to the operator's own network than to the target site.
 *
 * Pure and dependency-free by design: no DB handle, no `Crawler` instance.
 * This is the single predicate every consumer (`resetFailedPages`,
 * `listDnsBurnedHostCandidates`, `getSummary`'s attribution split) is
 * expected to call, so the inclusive/exclusive boundary decision below is
 * made exactly once.
 *
 * **Boundaries are inclusive on both ends.** A timestamp equal to
 * `startedAt` or `endedAt` counts as inside the window. This errs toward
 * attributing borderline errors to the outage rather than to the site:
 * classifying a genuinely network-caused failure as "unknown/site kills it
 * forever" (a false negative) is worse than the reverse (a false positive
 * merely costs one extra retry pass before the kind classifier sorts it out
 * again).
 * @param timestamp - Epoch ms to test (typically an error's `createdAt`).
 * @param windows - Resolved outage windows to test against. An empty array
 *   always yields `false` — this is what makes an archive with no
 *   `network_outages` rows (every archive created before this feature, or
 *   any crawl with no detected outage) behave identically to today.
 * @returns `true` if `timestamp` falls within any window.
 * @example
 * ```ts
 * isWithinOutageWindow(1_000, [{ startedAt: 500, endedAt: 1_500 }]); // true
 * isWithinOutageWindow(1_000, []); // false — no recorded outages
 * ```
 */
export function isWithinOutageWindow(
	timestamp: number,
	windows: readonly OutageWindow[],
): boolean {
	return windows.some(
		(window) => timestamp >= window.startedAt && timestamp <= window.endedAt,
	);
}
