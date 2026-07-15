import type { DB_Page } from '../../../types.js';
import type { Knex } from 'knex';

/**
 * Retrieves the current crawling state by listing scraped and pending URLs.
 *
 * `scraped` is straightforward: every page row whose `scraped` flag is `1`
 * — that is, every URL the crawl reached a terminal state on, including
 * setSkippedPage / setExternalPage / outright setPage success or failure.
 *
 * `pending` is intentionally STRICT — not "every `scraped = 0` row".
 * Three filters apply:
 *
 * 1. `scraped = 0` — work still incomplete.
 * 2. `isExternal = 0` — only in-scope work. External URLs go through a
 *    HEAD-only path that always lands on `scraped = 1` (either setPage or
 *    setExternalPage). A row with `isExternal = 1 AND scraped = 0` is
 *    therefore a data anomaly, and resume / inventory / append have no
 *    business retrying it on the next session.
 * 3. `EXISTS (anchor with hrefId = pages.id) OR source != 'crawled'` —
 *    the row was either discovered as an anchor destination during a
 *    previous scrape OR was explicitly tagged with a non-default
 *    source label (`'inventory-seed'`, `'inventory-discovered'`, …).
 *    Both halves of the OR represent "deliberately enqueued, expected
 *    to be processed", which is exactly what `resume` should pick up.
 *
 *    The orphan filter targets the **predicted-discard leak** in
 *    `crawler.ts` where `shouldDiscardPredicted` returns true but no
 *    `emit('skip')` follows. Such placeholders are inserted with the
 *    DB DEFAULT `source = 'crawled'` (no caller explicitly labels
 *    them) AND have no anchor referrer (predicted URLs are
 *    synthesised from pagination patterns, never anchored from a
 *    rendered page) — both halves of the OR are therefore false and
 *    the leak is excluded.
 *
 *    The `source != 'crawled'` clause specifically saves the
 *    `--inventory` × `--retry-failed` interaction: an inventory-seed
 *    URL came from the operator's URL list (no anchor referrer) and
 *    `resetFailedPages` puts it back at `scraped = 0`. Without this
 *    clause those legitimate retries would be dropped on resume.
 *
 * The defensive shape is on purpose: the data source can drift into
 * anomalous states under interruption, but the reader must never throw
 * or feed garbage back into the dealer. A real in-scope URL that was
 * truly interrupted mid-crawl will always have at least one anchor
 * referrer (otherwise the dealer would not have queued it), so the
 * strict filter loses no legitimate pending work.
 *
 * Seeds passed directly to `Crawler.start()` are NOT in the strict
 * pending set when they were never picked by the dealer — they have no
 * DB row at all in that case (`linkList.add` is purely in-memory until
 * `setPage` runs). A Ctrl-C between dealer pick and `setPage` likewise
 * leaves no row to recover. Recovery of un-picked seeds is the
 * responsibility of the caller (e.g. re-running `--inventory ./list.txt`
 * with the same URL list).
 *
 * The query uses an explicit `p` alias on the `pages` table so the
 * correlated `EXISTS` subquery can join via `whereRaw('anchors.hrefId =
 * p.id')`. A future refactor that renames the alias must update both
 * sites — the raw string in the subquery cannot be grep-resolved
 * automatically. Read-only / stub viewer connections never call this
 * method (they do not need to know about pending state), so the EXISTS
 * shape is safe to use without the `migrate*` guards that other writer
 * methods carry.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns An object with `scraped` (completed URLs) and `pending` (the
 *   strict set of in-scope, anchor-referenced, unfinished URLs).
 */
export async function getCrawlingState(
	knex: Knex,
): Promise<{ scraped: string[]; pending: string[] }> {
	const ex = (r: { url: string }) => r.url;
	const $scraped = await knex.select('url').from<DB_Page>('pages').where('scraped', 1);
	const scraped = $scraped.map(ex);
	const $pending = await knex
		.select('p.url')
		.from<DB_Page>({ p: 'pages' })
		.where('p.scraped', 0)
		.where('p.isExternal', 0)
		.where((qb) => {
			// "Anchored OR explicitly labelled". Either side is evidence
			// that the row was deliberately enqueued for processing —
			// only the predicted-discard leak (DEFAULT 'crawled' + no
			// anchor) fails both halves. The `whereExists` callback
			// uses `select('*')` since the column list is irrelevant
			// inside an EXISTS check; calling through `client.raw(...)`
			// would reach a private builder field.
			qb.whereExists(function () {
				this.select('*').from('anchors').whereRaw('anchors.hrefId = p.id');
			}).orWhereNot('p.source', 'crawled');
		});
	const pending = $pending.map(ex);
	return {
		scraped,
		pending,
	};
}
