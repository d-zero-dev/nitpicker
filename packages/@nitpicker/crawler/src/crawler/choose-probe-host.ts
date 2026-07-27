/**
 * Pick the hostname a network-outage probe should target.
 *
 * Prefers a host that has already answered successfully during this crawl
 * session (`Crawler.#successfulHosts` — the same "proven alive" evidence
 * `shouldBurnHost` uses) over a root URL's hostname, and never falls back to
 * a hardcoded external address (e.g. `1.1.1.1`): the probe should depend
 * only on infrastructure the crawl is already touching. `ReadonlySet`
 * iteration order in JS is insertion order, so this deterministically picks
 * the first host to have succeeded this session.
 * @param successfulHosts - Hostnames observed to respond in this session.
 * @param roots - The crawl's configured root URLs (`CrawlerOptions.roots`),
 *   used as a fallback before any host has succeeded yet.
 * @returns A probe target hostname, or `null` if neither source yields one
 *   (e.g. a fresh session with a malformed/empty roots list and no
 *   successes yet — the caller should treat this as "cannot probe").
 * @example
 * ```ts
 * chooseProbeHost(new Set(['a.example']), ['https://b.example/']); // 'a.example'
 * chooseProbeHost(new Set(), ['https://b.example/']); // 'b.example'
 * chooseProbeHost(new Set(), []); // null
 * ```
 */
export function chooseProbeHost(
	successfulHosts: ReadonlySet<string>,
	roots: readonly string[],
): string | null {
	const [firstSuccessfulHost] = successfulHosts;
	if (firstSuccessfulHost !== undefined) {
		return firstSuccessfulHost;
	}
	for (const root of roots) {
		try {
			return new URL(root).hostname;
		} catch {
			continue;
		}
	}
	return null;
}
