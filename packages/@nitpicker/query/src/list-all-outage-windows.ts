import type { ArchiveAccessor, OutageWindow } from '@nitpicker/crawler';

import { listNetworkOutages } from './list-network-outages.js';

/**
 * Effectively-unbounded page size for the internal `listNetworkOutages`
 * call below. Callers need every recorded outage window, not a page of
 * them — an archive accumulating anywhere near this many outages in one
 * lifetime is not a realistic scenario this needs to optimise for.
 */
const ALL_OUTAGES_LIMIT = 10_000;

/**
 * Fetch every recorded outage window for the archive, shaped for
 * `isWithinOutageWindow`. Shared by `getSummary` and `getErrorKinds` — both
 * need the full window set to decide each failure's `FailureAttribution`.
 * @param accessor - The opened archive accessor.
 * @returns All outage windows, unpaginated.
 */
export async function listAllOutageWindows(
	accessor: ArchiveAccessor,
): Promise<OutageWindow[]> {
	const { items } = await listNetworkOutages(accessor, { limit: ALL_OUTAGES_LIMIT });
	return items.map((item) => ({ startedAt: item.started_at, endedAt: item.ended_at }));
}
