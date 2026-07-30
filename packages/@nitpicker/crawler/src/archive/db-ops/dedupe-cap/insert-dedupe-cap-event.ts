import type { InsertDedupeCapEventParams } from '../../types.js';
import type { Knex } from 'knex';

/**
 * Appends one row to the `dedupe_cap_events` journal, with `rejected_count`
 * left `NULL` — the row starts life without a finalized rejection count.
 *
 * Called the instant `DedupeCapTracker#observe` confirms a URL shape as a
 * same-cluster trap (the `dedupeCap` event). See
 * `finalize-dedupe-cap-event.ts` for how `rejected_count` is later set.
 * @param knex - Knex query builder connected to the archive DB.
 * @param params - The newly-capped shape's fields to record.
 * @returns The autoincremented `id` of the newly-inserted row.
 */
export async function insertDedupeCapEvent(
	knex: Knex,
	params: InsertDedupeCapEventParams,
): Promise<number> {
	const inserted = await knex
		.from('dedupe_cap_events')
		.insert({
			shape_key: params.shapeKey,
			sample_url: params.sampleUrl,
			body_hash: params.bodyHash,
			effective_threshold: params.effectiveThreshold,
			observed_count: params.observedCount,
			detected_at: params.detectedAt,
			rejected_count: null,
		})
		.returning('id');
	const id = inserted[0]?.id;
	if (typeof id !== 'number') {
		throw new TypeError('insertDedupeCapEvent: INSERT returned no row id');
	}
	return id;
}
