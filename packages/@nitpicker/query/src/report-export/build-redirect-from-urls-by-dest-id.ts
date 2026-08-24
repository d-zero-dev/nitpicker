import type { ArchiveAccessor } from '@nitpicker/crawler';

import { groupValuesById } from './group-values-by-id.js';

/**
 * Builds a one-time reverse-redirect map (`redirect_dest_id` → source URLs)
 * for the Page List and Links report sheets' "Redirect From" column.
 *
 * A single full scan of `content_items WHERE redirect_dest_id IS NOT NULL`,
 * bounded by the number of redirects in the archive (normally a small
 * fraction of total pages) rather than by total page count — the same
 * one-shot-map shape `streamAllContentItems` uses for the same purpose,
 * extracted here so `listViewerPages`-driven Page List and
 * `streamAllContentItems`-driven Links can share one query instead of each
 * scanning `content_items` a second time.
 *
 * No read-model dependency: `content_items.redirect_dest_id` is a
 * write-model column, already pre-flattened to the final destination at
 * write time (see `linkRedirectSources`'s docs) — no chain-walk needed here.
 * @param accessor - The archive accessor to query.
 * @returns Map from a destination page's `content_items.id` to the URLs of
 *   every page that redirects to it. A page nothing redirects to has no
 *   entry.
 * @example
 * const redirectFrom = await buildRedirectFromUrlsByDestId(accessor);
 * const urlsForPage1 = redirectFrom.get(1) ?? [];
 */
export async function buildRedirectFromUrlsByDestId(
	accessor: ArchiveAccessor,
): Promise<Map<number, string[]>> {
	const knex = accessor.getKnex();
	const rows: { destId: number; sourceUrl: string }[] = await knex(
		'content_items as source',
	)
		.join('url_refs as source_url', 'source_url.id', 'source.url_id')
		.whereNotNull('source.redirect_dest_id')
		.select('source.redirect_dest_id as destId', 'source_url.url as sourceUrl');

	return groupValuesById(
		rows,
		(row) => row.destId,
		(row) => row.sourceUrl,
	);
}
