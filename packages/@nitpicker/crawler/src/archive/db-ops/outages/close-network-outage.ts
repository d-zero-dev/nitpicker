import type { Knex } from 'knex';

/**
 * Close an outage row by stamping `ended_at` — but ONLY if it is still
 * open. The `whereNull('ended_at')` guard is what makes this idempotent: a
 * second call (e.g. a duplicate recovery-probe success racing the first)
 * matches zero rows and is a silent no-op, rather than overwriting an
 * already-recorded `ended_at` with a later timestamp.
 * @param knex - Knex query builder connected to the archive DB.
 * @param id - The `network_outages.id` to close.
 * @param endedAt - Epoch ms the outage is considered to have ended.
 */
export async function closeNetworkOutage(
	knex: Knex,
	id: number,
	endedAt: number,
): Promise<void> {
	await knex('network_outages').where({ id }).whereNull('ended_at').update({
		ended_at: endedAt,
	});
}
