import type { InsertNetworkOutageParams } from '../../types.js';
import type { Knex } from 'knex';

/**
 * Appends one row to the `network_outages` journal, with `ended_at` left
 * `NULL` — the row starts life as an open outage.
 *
 * Called the moment a recovery probe CONFIRMS a suspect outage (i.e. the
 * probe itself failed, not merely the sliding-window threshold trip). See
 * `close-network-outage.ts` for how the row is later closed.
 * @param knex - Knex query builder connected to the archive DB.
 * @param params - The confirmed-outage fields to record.
 * @returns The autoincremented `id` of the newly-inserted row.
 */
export async function insertNetworkOutage(
	knex: Knex,
	params: InsertNetworkOutageParams,
): Promise<number> {
	const inserted = await knex
		.from('network_outages')
		.insert({
			started_at: params.startedAt,
			detected_at: params.detectedAt,
			ended_at: null,
			probe_host: params.probeHost,
			trigger_error_count: params.triggerErrorCount,
			trigger_host_count: params.triggerHostCount,
		})
		.returning('id');
	const id = inserted[0]?.id;
	if (typeof id !== 'number') {
		throw new TypeError('insertNetworkOutage: INSERT returned no row id');
	}
	return id;
}
