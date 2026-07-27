import type { NetworkOutageEntry, ListNetworkOutagesOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { computeOutageClampTimestamp } from '@nitpicker/crawler';

/**
 * List recorded network-outage audit rows from the archive, newest first.
 *
 * Surfaces the `network_outages` table so the CLI / MCP / viewer can answer
 * "when did the crawl operator's own network go down, and for how long" —
 * see {@link import('@nitpicker/crawler').NetworkOutageRow} for the
 * write-side contract.
 *
 * Tolerates a missing `network_outages` table: archives that predate the
 * table and read-only `stub` connections (`Archive.connect({ readOnly:
 * true })` skips migrations) both arrive here with no table. Returns
 * `{ items: [], total: 0 }` in that case rather than throwing — clients
 * call this unconditionally and a "no such table" exception would break
 * the viewer / MCP flows.
 *
 * A row left `ended_at = NULL` by a crawl process killed mid-outage is
 * resolved on the fly, via the shared `computeOutageClampTimestamp`, to the
 * archive's latest observed activity timestamp — this read-side shape
 * (`NetworkOutageEntry.ended_at`) is never `null`, so callers never need to
 * special-case an "unbounded" outage. The same clamp function is used by
 * `close-stale-open-network-outages.ts` (the writer-side finalizer), so the
 * two can never diverge on what "the archive's latest activity" means.
 *
 * Read-only — safe against viewer / stub-mode archives.
 * @param accessor - The archive accessor to query.
 * @param options - Pagination options.
 * @returns Paginated list of outages ordered by `started_at DESC`.
 * @example
 * ```ts
 * const { items, total } = await listNetworkOutages(accessor, { limit: 10 });
 * for (const outage of items) {
 *   const durationS = Math.round((outage.ended_at - outage.started_at) / 1000);
 *   console.log(`${outage.probe_host}: ${durationS}s`);
 * }
 * ```
 */
export async function listNetworkOutages(
	accessor: ArchiveAccessor,
	options: ListNetworkOutagesOptions = {},
): Promise<{ items: NetworkOutageEntry[]; total: number }> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	// Archives that predate the table and read-only stub connections both
	// arrive here without it. Bail out with an empty result instead of
	// letting knex raise "no such table: network_outages".
	const hasTable = await knex.schema.hasTable('network_outages');
	if (!hasTable) {
		return { items: [], total: 0 };
	}

	const countResult = (await knex('network_outages').count('id as total')) as {
		total: number;
	}[];
	const total = Number(countResult[0]?.total ?? 0);

	const rows = (await knex('network_outages')
		.select(
			'id',
			'started_at',
			'detected_at',
			'ended_at',
			'probe_host',
			'trigger_error_count',
			'trigger_host_count',
		)
		.orderBy('started_at', 'desc')
		.limit(limit)
		.offset(offset)) as {
		id: number;
		started_at: number;
		detected_at: number;
		ended_at: number | null;
		probe_host: string | null;
		trigger_error_count: number;
		trigger_host_count: number;
	}[];

	const hasOpenRow = rows.some((row) => row.ended_at === null);
	const clamp = hasOpenRow ? await computeOutageClampTimestamp(knex) : 0;

	const items: NetworkOutageEntry[] = rows.map((row) => ({
		...row,
		ended_at: row.ended_at ?? Math.max(clamp, row.started_at),
	}));

	return { items, total };
}
