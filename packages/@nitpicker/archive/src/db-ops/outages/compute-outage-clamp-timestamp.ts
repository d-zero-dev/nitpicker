import type { Knex } from 'knex';

/**
 * Compute the timestamp used to resolve an outage row whose `ended_at` is
 * still `NULL` (the crawl process was killed before a recovery probe could
 * close it) into a concrete, bounded window.
 *
 * The archive's own most-recent observations — the latest `crawl_errors`
 * timestamp and the latest `content_items.last_crawled_at` — are the only
 * evidence available for "when did activity in this archive last happen",
 * so the later of the two stands in for "the outage cannot have lasted
 * past this point, because the archive shows activity here". Using the
 * LARGER of the two (not just `crawl_errors`) matters because a session
 * that crashed mid-outage may have its last successful page write be more
 * recent than its last recorded error, or vice versa.
 *
 * Both source tables are guaranteed to exist by the time this runs — this
 * helper is only ever called from writer-context code (see
 * `list-network-outages.ts` / the boot-time stale-open finalizer), and
 * `initSchema` creates both `crawl_errors` and `content_items` before any
 * writer session's first query.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns The larger of `MAX(crawl_errors.createdAt)` and
 *   `MAX(content_items.last_crawled_at)`, or `0` if the archive has neither
 *   (a brand-new archive with no activity yet).
 */
export async function computeOutageClampTimestamp(knex: Knex): Promise<number> {
	const [crawlErrorsRow] = (await knex('crawl_errors').max(
		'createdAt as maxCreatedAt',
	)) as { maxCreatedAt: number | null }[];
	const [contentItemsRow] = (await knex('content_items').max(
		'last_crawled_at as maxLastCrawledAt',
	)) as { maxLastCrawledAt: number | null }[];

	const latestError = crawlErrorsRow?.maxCreatedAt ?? 0;
	const latestCrawl = contentItemsRow?.maxLastCrawledAt ?? 0;
	return Math.max(latestError, latestCrawl);
}
