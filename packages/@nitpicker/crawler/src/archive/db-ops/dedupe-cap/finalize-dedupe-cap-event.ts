import type { Knex } from 'knex';

/**
 * Finalizes a `dedupe_cap_events` row by stamping `rejected_count` — but
 * ONLY if it is still unset. The `whereNull('rejected_count')` guard makes
 * this idempotent, mirroring `close-network-outage.ts`'s `ended_at` guard: a
 * second call matches zero rows and is a silent no-op rather than
 * overwriting an already-finalized count.
 * @param knex - Knex query builder connected to the archive DB.
 * @param id - The `dedupe_cap_events.id` to finalize.
 * @param rejectedCount - Number of anchors rejected for this shape after it capped.
 */
export async function finalizeDedupeCapEvent(
	knex: Knex,
	id: number,
	rejectedCount: number,
): Promise<void> {
	await knex('dedupe_cap_events').where({ id }).whereNull('rejected_count').update({
		rejected_count: rejectedCount,
	});
}
