import type { OutageWindow } from '../../../is-within-outage-window.js';
import type { Knex } from 'knex';

import { computeOutageClampTimestamp } from './compute-outage-clamp-timestamp.js';

/**
 * List every recorded outage as a resolved (closed) {@link OutageWindow},
 * suitable for `isWithinOutageWindow`.
 *
 * This is the crawler-internal counterpart to `@nitpicker/query`'s richer
 * `listNetworkOutages` (full row shape, for CLI/MCP display) — this one
 * exists purely to feed the three write-path consumers
 * (`resetFailedPages`, `listDnsBurnedHostCandidates`, the gate itself) that
 * only need "was this timestamp inside an outage", never the row's other
 * columns.
 *
 * Any row whose `ended_at` is still `NULL` (the crawl process was killed
 * before recovery) is resolved on the fly via
 * {@link computeOutageClampTimestamp} rather than ever being returned as an
 * unbounded window — see `is-within-outage-window.ts`'s `OutageWindow`
 * docstring for why an open-ended window would be a correctness bug (every
 * later error would retroactively read as network-caused, forever). This
 * on-the-fly resolution does NOT persist to the row — it is a defensive
 * fallback independent of whichever boot-time finalizer durably closes
 * stale-open rows.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns Resolved outage windows. Empty when the archive predates the
 *   `network_outages` table (self-healed on next writer open, so this is
 *   never a permanent state) or has recorded no outages.
 */
export async function listNetworkOutages(knex: Knex): Promise<OutageWindow[]> {
	const hasTable = await knex.schema.hasTable('network_outages');
	if (!hasTable) {
		return [];
	}

	const rows = (await knex('network_outages').select('started_at', 'ended_at')) as {
		started_at: number;
		ended_at: number | null;
	}[];
	if (rows.length === 0) {
		return [];
	}

	const hasOpenRow = rows.some((row) => row.ended_at === null);
	const clamp = hasOpenRow ? await computeOutageClampTimestamp(knex) : 0;

	return rows.map((row) => ({
		startedAt: row.started_at,
		endedAt: row.ended_at ?? Math.max(clamp, row.started_at),
	}));
}
