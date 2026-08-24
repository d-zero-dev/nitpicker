import type { ExURL } from '@d-zero/shared/parse-url';

/**
 * Builds a per-origin directory grouping key from a parsed URL.
 *
 * Directory-index aggregation (inbound-link totals, title stripping) must
 * key by `(hostname, port, dirname)`, not `dirname` alone: a multi-root
 * crawl (`crawl <URL> <URL>...`, see the CLI's `crawl` docs) can have two
 * different origins sharing the same path (e.g. both crawled roots have a
 * `/blog/` index page) — a `dirname`-only key would merge their inbound-link
 * counts and titles across origins.
 * @param parsed - A parsed URL, or the subset of `ExURL` fields this needs.
 * @returns A string uniquely identifying the URL's `(hostname, port, dirname)`.
 */
export function originDirnameKey(
	parsed: Pick<ExURL, 'hostname' | 'port' | 'dirname'>,
): string {
	return `${parsed.hostname}:${parsed.port ?? ''}${parsed.dirname ?? '/'}`;
}
