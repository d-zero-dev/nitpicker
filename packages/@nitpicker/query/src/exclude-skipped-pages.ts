import type { Knex } from 'knex';

/**
 * Knex query-builder predicate that excludes pages matched by an `excludes`
 * pattern (recorded with `is_skipped = 1`). Such rows live in the
 * `content_items` table (Phase 6-C, PK-preserving replacement for the
 * legacy `pages` table) for discovery-side dedup but carry NULL `status` /
 * `content_type_id` because no scrape ever fired against them. Counting
 * them in any status / content-type aggregation produces a confusing
 * "Unknown / Errored" bucket.
 *
 * `OR is_skipped IS NULL` keeps pre-flag-era archives visible — rows
 * inserted before the column was added show up as NULL rather than 0.
 *
 * Use as a sub-query predicate:
 * ```ts
 * knex('content_items').where((qb) => excludeSkippedPages(qb)).select(...)
 * ```
 *
 * Mirrors the same predicate baked into `Database.resetFailedPages` —
 * inlined there to keep the writer path independent of `@nitpicker/query`.
 * @param qb - The Knex `QueryBuilder` (or sub-query callback `this`) to
 *   constrain. Mutated in place — pass the inner builder from a `.where`
 *   callback, not the outer query.
 * @param columnName - Fully-qualified column name (e.g. `ci.is_skipped`)
 *   when the surrounding query needs to disambiguate against a join;
 *   defaults to the bare column name.
 */
export function excludeSkippedPages(
	qb: Knex.QueryBuilder,
	columnName = 'is_skipped',
): void {
	qb.where(columnName, 0).orWhereNull(columnName);
}
