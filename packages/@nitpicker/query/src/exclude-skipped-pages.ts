import type { Knex } from 'knex';

/**
 * Knex query-builder predicate that excludes pages matched by an `excludes`
 * pattern (recorded with `isSkipped = 1`). Such rows live in the `pages`
 * table for discovery-side dedup but carry NULL `status` / `contentType`
 * because no scrape ever fired against them. Counting them in any
 * status / content-type aggregation produces a confusing "Unknown / Errored"
 * bucket (one production archive surfaced 2,799 rows in that bucket from a
 * single `--exclude` glob, dwarfing the actual 5xx tail).
 *
 * `OR isSkipped IS NULL` keeps pre-flag-era archives visible — rows
 * inserted before the column was added show up as NULL rather than 0.
 *
 * Use as a sub-query predicate:
 * ```ts
 * knex('pages').where((qb) => excludeSkippedPages(qb)).select(...)
 * ```
 *
 * Mirrors the same predicate baked into `Database.resetFailedPages` —
 * inlined there to keep the writer path independent of `@nitpicker/query`.
 * @param qb - The Knex `QueryBuilder` (or sub-query callback `this`) to
 *   constrain. Mutated in place — pass the inner builder from a `.where`
 *   callback, not the outer query.
 */
export function excludeSkippedPages(qb: Knex.QueryBuilder): void {
	qb.where('isSkipped', 0).orWhereNull('isSkipped');
}
