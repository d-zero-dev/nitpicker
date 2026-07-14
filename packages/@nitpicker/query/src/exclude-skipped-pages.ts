import type { Knex } from 'knex';

/**
 * Knex query-builder predicate that excludes pages matched by an `excludes`
 * pattern (recorded with `is_skipped = 1`). Such rows live in the
 * `content_items` table (0.13, PK-preserving replacement for the
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
 * knex('content_items').where((qb) => excludeSkippedPages(qb, 'is_skipped')).select(...)
 * ```
 *
 * Mirrors the same predicate baked into `Database.resetFailedPages` —
 * inlined there to keep the writer path independent of `@nitpicker/query`.
 * @param qb - The Knex `QueryBuilder` (or sub-query callback `this`) to
 *   constrain. Mutated in place — pass the inner builder from a `.where`
 *   callback, not the outer query.
 * @param columnName - Fully-qualified column name (e.g. `ci.is_skipped`).
 *   REQUIRED (no default) since 0.13: the pre-6 legacy `pages` table
 *   used `isSkipped` (camelCase) while the 0.13 `content_items`
 *   replacement uses `is_skipped` (snake_case). Forcing every caller to
 *   name the column at the callsite turns any missed migration into a
 *   TypeScript error rather than a silent SQL failure.
 */
export function excludeSkippedPages(qb: Knex.QueryBuilder, columnName: string): void {
	qb.where(columnName, 0).orWhereNull(columnName);
}
