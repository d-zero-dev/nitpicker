import type { PageSource, UnusedResourceEntry } from './types.js';
import type { Knex } from 'knex';

/** Row shape read from `resources` for the unused-resources list. */
interface UnusedResourceJoinRow {
	id: number;
	url: string;
	status: number | null;
	contentType: string | null;
	contentLength: number | null;
	source: string | null;
}

/**
 * Joins an already ID-limited, already-ordered `resource_id` list back to
 * the wide write-model `resources` table for full-metadata display, per
 * `docs/viewer-sql-query-plan.md`'s golden rule ("URL/text JOINs only after
 * IDs are limited"). The `IN (...)` fetch does not itself preserve
 * `resourceIds`' order (SQLite gives no such guarantee), so the result is
 * re-sorted in JS by `resourceIds`' order afterward — cheap, since this only
 * ever runs over a `limit`-bounded page (≤ a few hundred rows), never the
 * full archive.
 * @param knex - The archive's Knex instance.
 * @param resourceIds - The resource IDs to fetch, already
 *   filtered/sorted/limited by the `viewer_resources` query stage.
 * @returns The corresponding {@link UnusedResourceEntry} rows, in `resourceIds` order.
 */
export async function joinViewerUnusedResourceIdsToListItems(
	knex: Knex,
	resourceIds: number[],
): Promise<UnusedResourceEntry[]> {
	if (resourceIds.length === 0) {
		return [];
	}
	const rows: UnusedResourceJoinRow[] = await knex('resources')
		.whereIn('id', resourceIds)
		.select('id', 'url', 'status', 'contentType', 'contentLength', 'source');
	const rowsById = new Map(rows.map((row) => [row.id, row]));
	return resourceIds
		.map((id) => rowsById.get(id))
		.filter((row): row is UnusedResourceJoinRow => row != null)
		.map((row) => ({
			url: row.url,
			status: row.status,
			contentType: row.contentType,
			contentLength: row.contentLength,
			// Tolerate pre-migration archives where the column is absent —
			// `?? 'crawled'` mirrors the DB DEFAULT (see `listUnusedResources`).
			source: (row.source ?? 'crawled') as PageSource,
		}));
}
