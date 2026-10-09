import type { Knex } from 'knex';

/**
 * Adds `rejectedCount` onto the `rejected_count` of the `dedupe_cap_events`
 * row for `shapeKey`, treating a still-`NULL` count as `0`. Unlike
 * `finalize-dedupe-cap-event.ts` (which stamps a session's own newly-capped
 * shape exactly once, guarded by `whereNull`), this targets a shape that
 * capped in an EARLIER session and was preloaded into `DedupeCapTracker`'s
 * sticky set (see `DedupeCapTracker`'s constructor JSDoc) — gate rejections
 * for such a shape still occur in the current session, but no `dedupeCap`
 * event (and thus no new row) is ever emitted for it, since the tracker
 * short-circuits on an already-sticky shape before `observe` runs. Matches
 * by `shape_key` rather than `id` because the caller (`CrawlerOrchestrator`)
 * only has the shape key for a preloaded-sticky shape, never its row id.
 * @param knex - Knex query builder connected to the archive DB.
 * @param shapeKey - The capped shape whose rejection count to accumulate.
 * @param rejectedCount - Additional anchors rejected for this shape in the current session.
 */
export async function accumulateDedupeCapRejectedCount(
	knex: Knex,
	shapeKey: string,
	rejectedCount: number,
): Promise<void> {
	await knex('dedupe_cap_events')
		.where({ shape_key: shapeKey })
		.update({
			rejected_count: knex.raw('COALESCE(rejected_count, 0) + ?', [rejectedCount]),
		});
}
