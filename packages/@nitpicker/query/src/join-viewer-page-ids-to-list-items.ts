import type { PageListItem, PageListRow } from './types.js';
import type { Knex } from 'knex';

import { mapPageRowToListItem, PAGE_LIST_COLUMNS } from './map-page-row-to-list-item.js';

/**
 * Joins an already ID-limited, already-ordered `page_id` list back to the
 * wide write-model `pages` table for full-metadata display, per
 * `docs/viewer-sql-query-plan.md`'s golden rule ("URL/text JOINs only after
 * IDs are limited"). The `IN (...)` fetch from `pages` does not itself
 * preserve `pageIds`' order (SQLite gives no such guarantee), so the result
 * is re-sorted in JS by `pageIds`' order afterward — cheap, since this only
 * ever runs over a `limit`-bounded page (≤ a few hundred rows), never the
 * full archive.
 * @param knex - The archive's Knex instance.
 * @param pageIds - The page IDs to fetch, already filtered/sorted/limited by
 *   the `viewer_pages` query stage.
 * @returns The corresponding {@link PageListItem} rows, in `pageIds` order.
 */
export async function joinViewerPageIdsToListItems(
	knex: Knex,
	pageIds: number[],
): Promise<PageListItem[]> {
	if (pageIds.length === 0) {
		return [];
	}
	const rows: (PageListRow & { id: number })[] = await knex('pages')
		.whereIn('id', pageIds)
		.select('id', ...PAGE_LIST_COLUMNS);
	const rowsById = new Map(rows.map((row) => [row.id, row]));
	return pageIds
		.map((id) => rowsById.get(id))
		.filter((row): row is PageListRow & { id: number } => row != null)
		.map((row) => mapPageRowToListItem(row));
}
