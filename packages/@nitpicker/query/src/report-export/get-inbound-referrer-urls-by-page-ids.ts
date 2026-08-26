import type { InboundReferrerDetail } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { eachSplitted } from '@nitpicker/crawler';

import { SQLITE_IN_CHUNK } from '../sqlite-in-chunk.js';

import { groupValuesById } from './group-values-by-id.js';

/**
 * Fetches referrer detail for a batch of destination pages, from
 * `viewer_anchor_facts`.
 *
 * Pairs with `viewer_pages.inbound_link_count`/`dir_index_inbound_link_count`
 * (computed at read-model build time, see `build-viewer-read-model.ts`) for
 * the Page List report's "Internal Referrers" column, and with the Links
 * report's "Referrers" column: the numeric count comes from the read model
 * directly for Page List, or from summing every returned detail's
 * {@link InboundReferrerDetail.count} for Links; this function supplies
 * only the per-referrer detail. Formatting (joining, capping cell/note
 * length) is the caller's responsibility — see `join-urls-for-note.ts`.
 *
 * Lists referrers to the exact requested page id only — for a directory
 * index page that shares its combined count with sibling index variants
 * (e.g. both `/blog/` and `/blog/index.html` existing as distinct pages),
 * the detail list can undercount relative to
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
 * @param pageIds - Destination page ids to fetch referrer detail for (a
 *   `listViewerPages`/`streamAllContentItems` batch, typically).
 * @returns Map from `page_id` to its referrer detail. A page with no
 *   inbound links has no entry.
 * @example
 * const details = await getInboundReferrerUrlsByPageIds(accessor, [1, 2, 3]);
 * const forPage1 = details.get(1) ?? [];
 */
export async function getInboundReferrerUrlsByPageIds(
	accessor: ArchiveAccessor,
	pageIds: readonly number[],
): Promise<Map<number, InboundReferrerDetail[]>> {
	if (pageIds.length === 0) {
		return new Map();
	}
	const knex = accessor.getKnex();

	const allRows: {
		destPageId: number;
		sourceUrl: string;
		textContent: string | null;
		count: number;
		destUrlRefId: number;
		rawDestUrlRefId: number;
		rawDestUrl: string;
	}[] = [];
	await eachSplitted(pageIds, SQLITE_IN_CHUNK, async (chunk) => {
		const rows: typeof allRows = await knex('viewer_anchor_facts as vaf')
			.join('viewer_url_refs as source_ref', 'source_ref.id', 'vaf.source_url_ref_id')
			.join(
				'viewer_url_refs as raw_dest_ref',
				'raw_dest_ref.id',
				'vaf.raw_dest_url_ref_id',
			)
			.leftJoin('text_refs as text_ref', 'text_ref.id', 'vaf.first_text_id')
			.whereIn('vaf.dest_page_id', chunk)
			.select(
				'vaf.dest_page_id as destPageId',
				'source_ref.url as sourceUrl',
				'text_ref.text as textContent',
				'vaf.count as count',
				'vaf.dest_url_ref_id as destUrlRefId',
				'vaf.raw_dest_url_ref_id as rawDestUrlRefId',
				'raw_dest_ref.url as rawDestUrl',
			);
		// Avoid `push(...rows)`: on large real archives this chunk array can
		// be large enough to overflow V8's argument-spread limit even though
		// the underlying data itself fits in memory.
		for (const row of rows) {
			allRows.push(row);
		}
	});

	return groupValuesById(
		allRows,
		(row) => row.destPageId,
		(row): InboundReferrerDetail => ({
			url: row.sourceUrl,
			textContent: row.textContent,
			count: row.count,
			redirectedFromUrl: row.rawDestUrlRefId === row.destUrlRefId ? null : row.rawDestUrl,
		}),
	);
}
