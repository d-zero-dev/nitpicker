import type { Knex } from 'knex';

/** Rows read per `resource_items.id` keyset chunk. */
const READ_CHUNK_SIZE = 2000;

/**
 * Retrieves a flat list of all resource URLs from the `resource_items`
 * table. URL text is normalised into `url_refs`, so the read joins the
 * two tables and returns the resolved strings.
 *
 * Read in `resource_items.id`-keyset chunks rather than a single SELECT
 * (issue #294): on a resource-heavy archive (images/JS/CSS in the tens or
 * hundreds of thousands) this was one unbounded, multi-second-to-minutes
 * query with no way to report progress mid-scan. The accumulated result is
 * identical to the previous single-SELECT read — chunking exists purely to
 * make the scan observable, not to bound memory (the flat URL list is
 * already fully materialised for the caller either way).
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
	// MAX() over the keyset column is an O(1) index-tail read; only fetched
	// when someone is listening.
	let maxId = 0;
	if (onProgress) {
		const [maxRow] = await knex('resource_items').max<{ max: number | null }[]>({
			max: 'id',
		});
		maxId = maxRow?.max ?? 0;
	}

	const urls: string[] = [];
	let lastId = 0;
	for (;;) {
		const rows = (await knex('resource_items')
			.join('url_refs', 'url_refs.id', 'resource_items.url_id')
			.where('resource_items.id', '>', lastId)
			.orderBy('resource_items.id', 'asc')
			.limit(READ_CHUNK_SIZE)
			.select('resource_items.id as id', 'url_refs.url as url')) as {
			id: number;
			url: string;
		}[];
		if (rows.length === 0) {
			onProgress?.(maxId, maxId);
			break;
		}
		lastId = rows.at(-1)!.id;
		for (const row of rows) {
			urls.push(row.url);
		}
		onProgress?.(Math.min(lastId, maxId), maxId);
	}
	return urls;
}
