import type { PageSource, UnusedResourceEntry } from './types.js';
import type { Knex } from 'knex';

/** Row shape read from `resource_items` for the unused-resources list. */
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
 * the Phase 6-C `resource_items` write model for full-metadata display.
 * @param knex - The archive's Knex instance.
 * @param resourceIds - The resource IDs to fetch.
 * @returns The corresponding {@link UnusedResourceEntry} rows, in `resourceIds` order.
 */
export async function joinViewerUnusedResourceIdsToListItems(
	knex: Knex,
	resourceIds: number[],
): Promise<UnusedResourceEntry[]> {
	if (resourceIds.length === 0) {
		return [];
	}
	const rows: UnusedResourceJoinRow[] = await knex('resource_items as ri')
		.join('url_refs as ur', 'ur.id', 'ri.url_id')
		.leftJoin('content_type_refs as ctr', 'ctr.id', 'ri.content_type_id')
		.whereIn('ri.id', resourceIds)
		.select(
			'ri.id as id',
			'ur.url as url',
			'ri.status as status',
			'ctr.raw as contentType',
			'ri.content_length as contentLength',
			'ri.source as source',
		);
	const rowsById = new Map(rows.map((row) => [row.id, row]));
	return resourceIds
		.map((id) => rowsById.get(id))
		.filter((row): row is UnusedResourceJoinRow => row != null)
		.map((row) => ({
			url: row.url,
			status: row.status,
			contentType: row.contentType,
			contentLength: row.contentLength,
			source: (row.source ?? 'crawled') as PageSource,
		}));
}
