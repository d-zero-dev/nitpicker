import type { Knex } from 'knex';

import { keysetPaginateById } from '../_shared/keyset-paginate-by-id.js';

/** Rows read per `resource_items.id` keyset chunk. */
const READ_CHUNK_SIZE = 2000;

/**
 * Retrieves a flat list of all resource URLs from the `resource_items`
 * table. URL text is normalised into `url_refs`, so the read joins the
 * two tables and returns the resolved strings.
 *
 * Read in `resource_items.id`-keyset chunks rather than a single SELECT
 * (issue #294) via `keysetPaginateById` — see that function's JSDoc for
 * why (progress observability on a resource-heavy archive, not memory
 * bounding).
 * @param knex - Knex query builder connected to the archive DB.
 * @param onProgress - Called after each chunk with the `resource_items.id`
 *   scanned up to so far and the max id. Omit for no reporting (the
 *   default; e.g. tests).
 * @returns An array of resource URL strings.
 */
export async function getResourceUrlList(
	knex: Knex,
	onProgress?: (scannedUpToId: number, maxId: number) => void,
): Promise<string[]> {
	return keysetPaginateById<{ id: number; url: string }, string>(
		knex,
		'resource_items',
		(lastId) =>
			knex('resource_items')
				.join('url_refs', 'url_refs.id', 'resource_items.url_id')
				.where('resource_items.id', '>', lastId)
				.orderBy('resource_items.id', 'asc')
				.limit(READ_CHUNK_SIZE)
				.select('resource_items.id as id', 'url_refs.url as url'),
		(row) => row.url,
		onProgress,
	);
}
