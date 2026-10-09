import type { Knex } from 'knex';

import { closeNetworkOutage } from './close-network-outage.js';
import { computeOutageClampTimestamp } from './compute-outage-clamp-timestamp.js';

/**
 * Durably close every `network_outages` row still `ended_at = NULL` at the
 * start of a writer session.
 *
 * A row is left open only when the crawl process was killed (Ctrl-C / OOM
 * / SIGKILL) mid-outage, before a recovery probe could close it. Called
 * once from `db-ops/lifecycle/init.ts` — right after `initSchema` (which
 * guarantees the table exists) and before anything else touches
 * `network_outages` — so that by the time `resetFailedPages` /
 * `listDnsBurnedHostCandidates` / any other reader runs, no row can still
 * be open from a PRIOR session. (A row opened by THIS session cannot exist
 * yet at this point in the boot sequence — the sliding-window detector
 * only starts once the crawl loop begins.)
 *
 * This complements, but does not replace, `list-network-outages.ts`'s
 * on-the-fly clamp: that read-side resolution stays in place as a
 * defensive fallback, but after this runs there should be nothing left for
 * it to resolve.
 *
 * Idempotent: a row closed by a previous call (or by a normal
 * recovery-probe success) is simply absent from the `whereNull('ended_at')`
 * scan, so re-running this on every writer open is always safe.
 * @param knex - Knex query builder connected to the archive DB.
 */
export async function closeStaleOpenNetworkOutages(knex: Knex): Promise<void> {
	const hasTable = await knex.schema.hasTable('network_outages');
	if (!hasTable) {
		return;
	}

	const openRows = (await knex('network_outages')
		.whereNull('ended_at')
		.select('id', 'started_at')) as { id: number; started_at: number }[];
	if (openRows.length === 0) {
		return;
	}

	const clamp = await computeOutageClampTimestamp(knex);
	for (const row of openRows) {
		await closeNetworkOutage(knex, row.id, Math.max(clamp, row.started_at));
	}
}
