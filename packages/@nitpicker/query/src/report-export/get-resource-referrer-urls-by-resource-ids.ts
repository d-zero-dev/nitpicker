import type { ArchiveAccessor } from '@nitpicker/crawler';

import { getResourceReferrerEdges } from '../get-resource-referrer-edges.js';

import { groupValuesById } from './group-values-by-id.js';

/**
 * Fetches referrer page URLs for a batch of resources, from
 * `resource_ref_edges`.
 *
 * Pairs with `streamAllResourcesRaw`'s per-resource `referrerCount` (a cheap
 * correlated sum) for the Resources report sheet's "Referrers" note column:
 * the count comes from the stream row directly, this function supplies only
 * the URL-list detail — the same two-function split
 * `getOutboundLinkFactsByPageIds`/`getInboundLinkNotesByPageIds` uses for
 * Page List.
 * @param accessor - The archive accessor to query.
 * @param resourceIds - `resource_items` ids to fetch referrer URLs for (a
 *   `streamAllResourcesRaw` chunk, typically).
 * @returns Map from `resource_id` to its referrer page URLs. A resource
 *   with no referrers has no entry.
 * @example
 * const urls = await getResourceReferrerUrlsByResourceIds(accessor, [1, 2, 3]);
 * const forResource1 = urls.get(1) ?? [];
 */
export async function getResourceReferrerUrlsByResourceIds(
	accessor: ArchiveAccessor,
	resourceIds: readonly number[],
): Promise<Map<number, string[]>> {
	if (resourceIds.length === 0) {
		return new Map();
	}
	const rows = await getResourceReferrerEdges(accessor.getKnex(), resourceIds);

	return groupValuesById(
		rows,
		(row) => row.resourceId,
		(row) => row.pageUrl,
	);
}
