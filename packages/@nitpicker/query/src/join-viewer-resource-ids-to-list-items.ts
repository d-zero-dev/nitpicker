import type { ResourceEntry } from './types.js';
import type { Knex } from 'knex';

/** Row shape read from `resources` joined to `viewer_resource_stats`. */
interface ResourceJoinRow {
	id: number;
	url: string;
	status: number | null;
	statusText: string | null;
	contentType: string | null;
	contentLength: number | null;
	isExternal: 0 | 1;
	// `resources.compress`/`.cdn` are TEXT-affinity columns; a falsy
	// `Resource.compress`/`.cdn` is written as the JS number `0`
	// (`resource.compress || 0` in `insertResource`), which SQLite's TEXT
	// affinity casts to the string `'0.0'` on write — never the bare number
	// `0` — so both sentinels are checked below, matching `listResources`.
	compress: string | 0 | '0.0';
	cdn: string | 0 | '0.0';
	referrerCount: number;
}

/**
 * Joins an already ID-limited, already-ordered `resource_id` list back to
 * the wide write-model `resources` table (plus `viewer_resource_stats` for
 * the precomputed `referrerCount`) for full-metadata display, per
 * `docs/viewer-sql-query-plan.md`'s golden rule ("URL/text JOINs only after
 * IDs are limited"). The `IN (...)` fetch does not itself preserve
 * `resourceIds`' order (SQLite gives no such guarantee), so the result is
 * re-sorted in JS by `resourceIds`' order afterward — cheap, since this only
 * ever runs over a `limit`-bounded page (≤ a few hundred rows), never the
 * full archive.
 * @param knex - The archive's Knex instance.
 * @param resourceIds - The resource IDs to fetch, already
 *   filtered/sorted/limited by the `viewer_resources` query stage.
 * @returns The corresponding {@link ResourceEntry} rows, in `resourceIds` order.
 */
export async function joinViewerResourceIdsToListItems(
	knex: Knex,
	resourceIds: number[],
): Promise<ResourceEntry[]> {
	if (resourceIds.length === 0) {
		return [];
	}
	const rows: ResourceJoinRow[] = await knex('resources')
		.leftJoin(
			'viewer_resource_stats',
			'viewer_resource_stats.resource_id',
			'resources.id',
		)
		.whereIn('resources.id', resourceIds)
		.select(
			'resources.id as id',
			'resources.url as url',
			'resources.status as status',
			'resources.statusText as statusText',
			'resources.contentType as contentType',
			'resources.contentLength as contentLength',
			'resources.isExternal as isExternal',
			'resources.compress as compress',
			'resources.cdn as cdn',
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
