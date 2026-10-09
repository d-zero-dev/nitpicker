import type { Knex } from 'knex';

/**
 * Reads every row a caller-supplied query matches, in ascending-`id`
 * keyset-paginated chunks rather than one unbounded SELECT (issue #294): on
 * a large archive, a single multi-second-to-minutes scan gives the caller
 * no way to report progress mid-read. The accumulated result is identical
 * to a single un-chunked SELECT — chunking exists purely to make the scan
 * observable, not to bound memory (the mapped output is already fully
 * materialised for the caller either way).
 *
 * Extracted from `getResourceUrlList` / `listDedupeCapObservations`, which
 * had grown byte-for-byte identical pagination boilerplate (the `MAX(id)`
 * probe, the `for (;;)` chunk loop, the `onProgress` shape) around two
 * otherwise-unrelated queries. Callers own everything query-shaped
 * (joins, `WHERE`, `SELECT`, chunk size via `.limit()` inside
 * `buildQuery`) — this helper only owns the keyset-chunking mechanics
 * common to both.
 * @param knex - Knex query builder connected to the archive DB.
 * @param idTable - The table `id` keys off, used for the O(1) `MAX(id)`
 *   probe that seeds `onProgress`'s total (only queried when `onProgress`
 *   is given).
 * @param buildQuery - Builds one chunk's query given the last-seen `id`
 *   (`0` on the first call). Must filter on `id > lastId`, order by `id`
 *   ascending, and cap the row count (typically via `.limit()`) — this
 *   helper does not add any of those clauses itself. The resolved rows
 *   must each carry an `id` field so the next chunk's cursor can advance.
 * @param mapRow - Transforms one raw row into the caller's output shape.
 * @param onProgress - Called after each chunk, with the highest `id`
 *   scanned so far and the max `id` in `idTable`. Omit for no reporting.
 * @returns Every matched row, mapped via `mapRow`, in `id` order.
 * @example
 * ```ts
 * const urls = await keysetPaginateById(
 * 	knex,
 * 	'resource_items',
 * 	(lastId) =>
 * 		knex('resource_items')
 * 			.join('url_refs', 'url_refs.id', 'resource_items.url_id')
 * 			.where('resource_items.id', '>', lastId)
 * 			.orderBy('resource_items.id', 'asc')
 * 			.limit(2000)
 * 			.select('resource_items.id as id', 'url_refs.url as url'),
 * 	(row) => row.url,
 * );
 * ```
 */
export async function keysetPaginateById<Row extends { id: number }, Out>(
	knex: Knex,
	idTable: string,
	buildQuery: (lastId: number) => Knex.QueryBuilder,
	mapRow: (row: Row) => Out,
	onProgress?: (scannedUpToId: number, maxId: number) => void,
): Promise<Out[]> {
	// MAX() over the keyset column is an O(1) index-tail read; only fetched
	// when someone is listening.
	let maxId = 0;
	if (onProgress) {
		const [maxRow] = await knex(idTable).max<{ max: number | null }[]>({ max: 'id' });
		maxId = maxRow?.max ?? 0;
	}

	const results: Out[] = [];
	let lastId = 0;
	for (;;) {
		const rows = (await buildQuery(lastId)) as Row[];
		if (rows.length === 0) {
			onProgress?.(maxId, maxId);
			break;
		}
		lastId = rows.at(-1)!.id;
		for (const row of rows) {
			results.push(mapRow(row));
		}
		onProgress?.(Math.min(lastId, maxId), maxId);
	}
	return results;
}
