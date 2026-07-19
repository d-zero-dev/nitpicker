import type { Knex } from 'knex';

import { classifyErrorKind } from '../../../classify-error-kind.js';

/**
 * Hostnames whose `crawl_errors` history is consistently DNS failures and
 * for which no recent 2xx-3xx page or resource is recorded — i.e. hosts
 * the previous crawl already proved unreachable. Returned in lower-cased
 * form. Used by `CrawlerOrchestrator.#preloadDnsBurnedHostCache` so the
 * next session short-circuits HEAD pre-flight on these hosts.
 *
 * Implementation: a coarse `LIKE` filter over `crawl_errors.message`
 * narrows the row set, then `classifyErrorKind` confirms `'dns'` in JS
 * (the regex is the single truth source — DB-side filters never narrow
 * it). Exclusion bags are built from a single `pages` and a single
 * `resources` scan: any host with a 2xx-3xx page, a 2xx-3xx resource, or
 * a `pages.lastCrawledAt` newer than its latest DNS error is dropped
 * (the host probably recovered between the failure and the last crawl).
 *
 * Returns `[]` on legacy archives that pre-date the `crawl_errors`
 * table — the `hasTable` guard keeps the call non-destructive.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns Lower-cased hostnames safe to short-circuit.
 */
export async function listDnsBurnedHostCandidates(knex: Knex): Promise<string[]> {
	const hasCrawlErrors = await knex.schema.hasTable('crawl_errors');
	if (!hasCrawlErrors) {
		return [];
	}

	// Coarse SQL filter: cheap LIKE OR-chain over `message`. The dns regex
	// truth source lives in `classifyErrorKind`, so we only need to feed it
	// rows that COULD match a DNS token. Each LIKE is anchored on a known
	// substring of the regex so future additions to the regex (without
	// matching new SQL terms) widen the JS-side filter only — never narrow it.
	//
	// `%EAI_AGAIN%` is deliberately NOT in the SQL filter: it now classifies
	// as `dns-transient` (local resolver hiccup), not `dns`, so it must not
	// reach this candidate set. The `%getaddrinfo%` term still pulls
	// `getaddrinfo EAI_AGAIN ...` rows but the JS-side `classifyErrorKind`
	// check (first-match-wins) routes them to `dns-transient` and they
	// silently drop out — keeping the cache focused on real NXDOMAIN.
	const dnsLikeRows = (await knex('crawl_errors')
		.select('url', 'message', 'createdAt')
		.whereNotNull('url')
		.where((qb) => {
			qb.where('message', 'like', '%ENOTFOUND%')
				.orWhere('message', 'like', '%getaddrinfo%')
				.orWhere('message', 'like', '%ERR_NAME_NOT_RESOLVED%')
				.orWhere('message', 'like', '%ERR_NAME_RESOLUTION_FAILED%');
		})) as { url: string; message: string; createdAt: number }[];

	if (dnsLikeRows.length === 0) {
		return [];
	}

	// Map<hostname, latestErrorCreatedAt> for hosts whose error message
	// confidently classifies as DNS (LIKE matched but classifyErrorKind says
	// e.g. `unknown` → drop).
	const candidateLatestErrorAt = new Map<string, number>();
	for (const row of dnsLikeRows) {
		if (classifyErrorKind(row.message) !== 'dns') {
			continue;
		}
		let host: string;
		try {
			host = new URL(row.url).hostname.toLowerCase();
		} catch {
			continue;
		}
		if (!host) {
			continue;
		}
		const createdAt = typeof row.createdAt === 'number' ? row.createdAt : 0;
		const previous = candidateLatestErrorAt.get(host) ?? 0;
		if (createdAt > previous) {
			candidateLatestErrorAt.set(host, createdAt);
		}
	}

	if (candidateLatestErrorAt.size === 0) {
		return [];
	}

	// Exclusion-bag #1: pages with a 2xx-3xx status anywhere on the host.
	// Tracking the latest `last_crawled_at` per host lets us additionally
	// drop hosts whose last successful contact post-dates the most recent
	// DNS error (the host probably came back after a transient outage).
	const pageOkRows = (await knex('content_items')
		.join('url_refs', 'content_items.url_id', 'url_refs.id')
		.select('url_refs.url as url', 'content_items.last_crawled_at as lastCrawledAt')
		.whereBetween('content_items.status', [200, 399])) as {
		url: string;
		lastCrawledAt: number | null;
	}[];
	const pageOkHosts = new Set<string>();
	const latestPageOkAt = new Map<string, number>();
	for (const row of pageOkRows) {
		let host: string;
		try {
			host = new URL(row.url).hostname.toLowerCase();
		} catch {
			continue;
		}
		pageOkHosts.add(host);
		if (typeof row.lastCrawledAt === 'number') {
			const previous = latestPageOkAt.get(host) ?? 0;
			if (row.lastCrawledAt > previous) {
				latestPageOkAt.set(host, row.lastCrawledAt);
			}
		}
	}

	// Exclusion-bag #2: non-HTML resources with a 2xx-3xx status. resources
	// have no timestamp column so this is presence-only.
	const resourceOkRows = (await knex('resource_items')
		.join('url_refs', 'resource_items.url_id', 'url_refs.id')
		.select('url_refs.url as url')
		.whereBetween('resource_items.status', [200, 399])) as { url: string }[];
	const resourceOkHosts = new Set<string>();
	for (const row of resourceOkRows) {
		let host: string;
		try {
			host = new URL(row.url).hostname.toLowerCase();
		} catch {
			continue;
		}
		resourceOkHosts.add(host);
	}

	// A candidate host is burned only if neither pages nor resources hold a
	// 2xx-3xx for it, AND its latest 2xx page (if any) is not newer than
	// the latest DNS error. The third check guards against re-burning a
	// host that recovered between the last DNS failure and the most recent
	// crawl.
	const burned: string[] = [];
	for (const [host, latestErrorAt] of candidateLatestErrorAt) {
		if (pageOkHosts.has(host)) {
			continue;
		}
		if (resourceOkHosts.has(host)) {
			continue;
		}
		const latestOkAt = latestPageOkAt.get(host);
		if (typeof latestOkAt === 'number' && latestOkAt > latestErrorAt) {
			continue;
		}
		burned.push(host);
	}
	return burned;
}
