import type { ResourceEntry } from './types.js';
import type { Knex } from 'knex';

/** Row shape read from `resource_items` joined to `viewer_resource_stats`. */
interface ResourceJoinRow {
	id: number;
	url: string;
	status: number | null;
	statusText: string | null;
	contentType: string | null;
	contentLength: number | null;
	isExternal: 0 | 1;
	compress: string | 0 | '0.0';
	cdn: string | 0 | '0.0';
	referrerCount: number;
}

/**
 * Joins an already ID-limited, already-ordered `resource_id` list back to
 * the 0.13 `resource_items` write model (plus `viewer_resource_stats`
 * for the precomputed `referrerCount`) for full-metadata display.
 * @param knex - The archive's Knex instance.
 * @param resourceIds - The resource IDs to fetch.
 * @returns The corresponding {@link ResourceEntry} rows, in `resourceIds` order.
 */
export async function joinViewerResourceIdsToListItems(
	knex: Knex,
	resourceIds: number[],
): Promise<ResourceEntry[]> {
	if (resourceIds.length === 0) {
		return [];
	}
	const rows: ResourceJoinRow[] = await knex('resource_items as ri')
		.join('url_refs as ur', 'ur.id', 'ri.url_id')
		.leftJoin('content_type_refs as ctr', 'ctr.id', 'ri.content_type_id')
		.leftJoin('viewer_resource_stats', 'viewer_resource_stats.resource_id', 'ri.id')
		.whereIn('ri.id', resourceIds)
		.select(
			'ri.id as id',
			'ur.url as url',
			'ri.status as status',
			'ri.status_text as statusText',
			'ctr.raw as contentType',
			'ri.content_length as contentLength',
			'ri.is_external as isExternal',
			'ri.compress as compress',
			'ri.cdn as cdn',
			knex.raw(
				'coalesce("viewer_resource_stats"."referrer_count", 0) as "referrerCount"',
			),
		);
	const rowsById = new Map(rows.map((row) => [row.id, row]));
	return resourceIds
		.map((id) => rowsById.get(id))
		.filter((row): row is ResourceJoinRow => row != null)
		.map((row) => ({
			url: row.url,
			status: row.status,
			statusText: row.statusText,
			contentType: row.contentType,
			contentLength: row.contentLength,
			isExternal: !!row.isExternal,
			referrerCount: Number(row.referrerCount),
			compress: row.compress === 0 || row.compress === '0.0' ? null : row.compress,
			cdn: row.cdn === 0 || row.cdn === '0.0' ? null : row.cdn,
		}));
}
