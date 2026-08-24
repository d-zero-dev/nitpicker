import type { ArchiveAccessor } from '@nitpicker/crawler';

import { groupValuesById } from './group-values-by-id.js';

/**
 * Fetches referrer page URLs for a batch of destination pages, from
 * `viewer_anchor_facts`.
 *
 * Pairs with `viewer_pages.inbound_link_count`/`dir_index_inbound_link_count`
 * (computed at read-model build time, see `build-viewer-read-model.ts`) for
 * the Page List report's "Internal Referrers" column, and with the Links
 * report's "Referrers" column: the numeric count comes from the read model
 * directly for Page List, or from this array's own `.length` for Links;
 * this function supplies only the URL-list detail. Formatting (joining,
 * capping cell/note length) is the caller's responsibility — see
 * `join-urls-for-note.ts`.
 *
 * Lists referrers to the exact requested page id only — for a directory
 * index page that shares its combined count with sibling index variants
 * (e.g. both `/blog/` and `/blog/index.html` existing as distinct pages),
 * the URL list can undercount relative to
 * `viewer_pages.dir_index_inbound_link_count` (referrers to a sibling
 * variant are not listed here). Merging sibling lists would require knowing
 * the full sibling group up front — a directory scan this batch-oriented
 * function does not do. Accepted as a documented report non-compat gap
 * (the numeric column stays correct; the URL list is best-effort detail).
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current (see
 *   `isViewerReadModelCurrent`) before calling this — see
 *   `getOutboundLinkFactsByPageIds`'s docs for why the check happens once
 *   per report run, not once per batch.
 * @param pageIds - Destination page ids to fetch referrer URLs for (a
 *   `listViewerPages`/`streamAllContentItems` batch, typically).
 * @returns Map from `page_id` to its referrer page URLs. A page with no
 *   inbound links has no entry.
 * @example
 * const urls = await getInboundReferrerUrlsByPageIds(accessor, [1, 2, 3]);
 * const forPage1 = urls.get(1) ?? [];
 */
export async function getInboundReferrerUrlsByPageIds(
	accessor: ArchiveAccessor,
	pageIds: readonly number[],
): Promise<Map<number, string[]>> {
	if (pageIds.length === 0) {
		return new Map();
	}
	const knex = accessor.getKnex();

	const rows: { destPageId: number; sourceUrl: string }[] = await knex(
		'viewer_anchor_facts as vaf',
	)
		.join('viewer_url_refs as source_ref', 'source_ref.id', 'vaf.source_url_ref_id')
		.whereIn('vaf.dest_page_id', [...pageIds])
		.select('vaf.dest_page_id as destPageId', 'source_ref.url as sourceUrl');

	return groupValuesById(
		rows,
		(row) => row.destPageId,
		(row) => row.sourceUrl,
	);
}
