import { lookup } from 'node:dns';

/**
 * Function shape for an injectable network-reachability probe: given a
 * hostname, resolve to `true` if the network path to it appears healthy,
 * `false` otherwise. Never rejects — a probe failure is a normal outcome
 * (that's the whole point of probing), not an exceptional one.
 *
 * Injected via `CrawlerOptions.networkProbe` so tests can simulate
 * confirmed outages and recoveries deterministically (a function that fails
 * N times then starts succeeding) without touching the real network — the
 * same injection pattern as `ResourceLookup` / `PageSourceLookup`.
 */
export type NetworkProbe = (host: string) => Promise<boolean>;

/**
 * Default {@link NetworkProbe}: an active `dns.lookup` against `host`.
 *
 * Deliberately does not hit a hardcoded external address (e.g. `1.1.1.1`) —
 * probing a host that has already answered successfully during this crawl
 * session (see `choose-probe-host.ts`) avoids depending on infrastructure
 * outside the sites actually being crawled. `dns.lookup` alone is enough:
 * it exercises the operator's local resolver / network path, which is
 * exactly the layer an operator-side outage breaks.
 * @param host - Hostname to resolve.
 * @returns `true` if the lookup succeeds, `false` on any error (including
 *   NXDOMAIN, timeout, or resolver unavailability).
 */
export function probeNetwork(host: string): Promise<boolean> {
	return new Promise((resolve) => {
		lookup(host, (error) => {
			resolve(!error);
		});
	});
}
