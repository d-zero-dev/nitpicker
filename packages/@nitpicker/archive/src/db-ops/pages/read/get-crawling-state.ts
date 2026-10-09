import type { Knex } from 'knex';

import { computeShapeKey } from '../../../url-pattern/compute-shape-key.js';
import { listDedupeCapShapeKeys } from '../../dedupe-cap/list-dedupe-cap-shape-keys.js';

/**
 * Retrieves the current crawling state by listing scraped and pending URLs.
 *
 * `scraped` is straightforward: every page row whose `scraped` flag is `1`
 * — that is, every URL the crawl reached a terminal state on, including
 * setSkippedPage / setExternalPage / outright setPage success or failure.
 *
 * `pending` is intentionally STRICT — not "every `scraped = 0` row".
 * Four filters apply:
 *
 * 1. `scraped = 0` — work still incomplete.
 * 2. `is_external = 0` — only in-scope work. External URLs go through a
 *    HEAD-only path that always lands on `scraped = 1` (either setPage or
 *    setExternalPage). A row with `is_external = 1 AND scraped = 0` is
 *    therefore a data anomaly, and resume / inventory / append have no
 *    business retrying it on the next session.
 * 3. `EXISTS (anchor_edges with href_page_id = content_items.id) OR source
 *    != 'crawled'` — the row was either discovered as an anchor destination
 *    during a previous scrape OR was explicitly tagged with a non-default
 *    source label (`'inventory-seed'`, `'inventory-discovered'`, …). Both
 *    halves of the OR represent "deliberately enqueued, expected to be
 *    processed", which is exactly what `resume` should pick up.
 *
 *    The orphan filter targets the **predicted-discard leak** in
 *    `@nitpicker/crawler`'s `crawler/crawler.ts` where `shouldDiscardPredicted` returns true but no
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
 * 4. **Confirmed same-cluster trap exclusion** (issue #350): a row whose
 *    URL shape (`computeShapeKey`) matches a `dedupe_cap_events.shape_key`
 *    already recorded in this archive is dropped, UNLESS its `source` is
 *    `'inventory-seed'` (an operator-listed URL, not an anchor-discovered
 *    one — the same "explicit URL survives cap" carve-out `resetPagesByUrls`
 *    gives `--recrawl`). NOT the same as `resetFailedPages`'s own
 *    same-shape exclusion, which drops a matching candidate regardless of
 *    `source` — a `scraped=1, status=-1` inventory-seed row of a
 *    confirmed-capped shape is therefore excluded there too and never
 *    resets to `scraped=0` for `--retry-failed` to pick back up. That
 *    asymmetry pre-dates this filter and is unrelated to it (out of scope
 *    here): this filter only decides what `getCrawlingState` reports as
 *    `pending`, never whether a `scraped=1` row gets reset in the first
 *    place.
 *
 *    Why this is needed: `--dedupe-cap`'s enqueue gate (`@nitpicker/crawler`'s `crawler/crawler.ts`
 *    `addUrl` closure) only stops a capped shape's anchor from being
 *    ADDED TO THE QUEUE in memory — it does not stop `replaceAnchorEdges`
 *    (`update-page.ts`) from writing a `scraped = 0` row for that same
 *    anchor (post-hoc marking, `content_items.dedupe_cap_event_id`,
 *    deliberately needs that row to exist). Before this filter, such a
 *    row still satisfied filter 3 (it has an anchor referrer) and entered
 *    `pending`, so `CrawlerOrchestrator#crawlUntilPendingClears`'s
 *    auto-retry loop (and any `--resume`/`--retry-failed`/`--append`) would
 *    requeue it — `Crawler#resume`'s `LinkList#resume` has no cap gate of
 *    its own — actually fetch the trap page, and its anchors would create
 *    a fresh batch of same-shape `scraped = 0` rows. Pending never shrank,
 *    so the loop ended in `PendingUrlsRemainError('no-progress')` even
 *    though nothing was actually wrong with the target site.
 *
 *    Why not skip the row instead of merely omitting it from `pending`:
 *    this function is read-only — leaving `is_skipped`/`skip_reason`
 *    unset keeps `dedupe_cap_event_id` backfill (`viewer-build`) as the
 *    single place that judges a row "capped", matching the archive's
 *    existing dedupe-cap post-hoc-marking pattern rather than adding a
 *    second one here.
 *
 *    A row whose shape cannot be computed (`computeShapeKey` returns
 *    `null`) stays in `pending` — no signal either way, same
 *    err-on-the-side-of-retrying choice `resetFailedPages` makes.
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
 * The query uses an explicit `ci` alias on the `content_items` table so the
 * correlated `EXISTS` subquery can join via `whereRaw('anchor_edges.href_page_id
 * = ci.id')`. A future refactor that renames the alias must update both
 * sites — the raw string in the subquery cannot be grep-resolved
 * automatically. Read-only / stub viewer connections never call this
 * method (they do not need to know about pending state), so the EXISTS
 * shape is safe to use without the `migrate*` guards that other writer
 * methods carry.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns An object with `scraped` (completed URLs), `pending` (the
 *   strict set of in-scope, anchor-referenced, unfinished, non-capped
 *   URLs), and `pendingMetadataOnly` (the subset of `pending` whose
 *   `content_items.is_metadata_only` was persisted as `1` — see
 *   `replaceAnchorEdges`/`resolveContentItemId`). Callers that resume a
 *   crawl (`Crawler#resume` → `LinkList#resume`) pass this subset through
 *   so a metadata-only anchor discovered before an interruption is not
 *   silently promoted to a full-scrape target on resume (#369).
 */
export async function getCrawlingState(
	knex: Knex,
): Promise<{ scraped: string[]; pending: string[]; pendingMetadataOnly: string[] }> {
	const ex = (r: { url: string }) => r.url;
	const $scraped = await knex('content_items')
		.join('url_refs', 'url_refs.id', 'content_items.url_id')
		.select('url_refs.url as url')
		.where('content_items.scraped', 1);
	const scraped = $scraped.map(ex);
	const $pending = await knex
		.select(
			'ur.url as url',
			'ci.is_metadata_only as isMetadataOnly',
			'ci.source as source',
		)
		.from({ ci: 'content_items' })
		.join({ ur: 'url_refs' }, 'ur.id', 'ci.url_id')
		.where('ci.scraped', 0)
		.where('ci.is_external', 0)
		.where((qb) => {
			// "Anchored OR explicitly labelled". Either side is evidence
			// that the row was deliberately enqueued for processing —
			// only the predicted-discard leak (DEFAULT 'crawled' + no
			// anchor) fails both halves. The `whereExists` callback
			// uses `select('*')` since the column list is irrelevant
			// inside an EXISTS check; calling through `client.raw(...)`
			// would reach a private builder field.
			qb.whereExists(function () {
				this.select('*')
					.from('anchor_edges')
					.whereRaw('anchor_edges.href_page_id = ci.id');
			}).orWhereNot('ci.source', 'crawled');
		});
	// Confirmed same-cluster trap exclusion (filter 4, see this function's
	// JSDoc) — an archive with no recorded cap events behaves exactly as
	// before this filter existed (`cappedShapeKeys.size === 0` short-circuits
	// to a no-op, same guard `resetFailedPages` uses).
	const cappedShapeKeys = new Set(await listDedupeCapShapeKeys(knex));
	const $notCapped =
		cappedShapeKeys.size === 0
			? $pending
			: $pending.filter((row) => {
					if (row.source === 'inventory-seed') return true;
					const shapeKey = computeShapeKey(row.url);
					return shapeKey === null || !cappedShapeKeys.has(shapeKey);
				});
	const pending = $notCapped.map(ex);
	const pendingMetadataOnly = $notCapped.filter((r) => r.isMetadataOnly === 1).map(ex);
	return {
		scraped,
		pending,
		pendingMetadataOnly,
	};
}
