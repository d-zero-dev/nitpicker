import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Reads a table's URL column in fixed-size chunks using `id`-based keyset
 * pagination (`WHERE id > :last ORDER BY id LIMIT :size`) instead of
 * `OFFSET`, so each read is a direct index seek rather than an
 * O(offset) scan.
 *
 * Phase 6-F: reads Phase 6-C entity tables (`content_items` for pages,
 * `resource_items` for resources) joined to `url_refs` for the URL string.
 * @param accessor - The opened archive accessor.
 * @param table - The logical table to read URLs from
 *   (`pages`/`resources` — mapped internally to `content_items` /
 *   `resource_items`).
 * @param chunkSize - Maximum rows per chunk.
 * @yields {string[]} Each chunk's URL values, at most `chunkSize` long.
 */
export async function* readUrlChunks(
	accessor: ArchiveAccessor,
	table: 'pages' | 'resources',
	chunkSize: number,
): AsyncGenerator<string[]> {
	const knex = accessor.getKnex();
	const entityTable = table === 'pages' ? 'content_items' : 'resource_items';
	let lastId = 0;
	for (;;) {
		const rows = (await knex(`${entityTable} as ei`)
			.join('url_refs as ur', 'ur.id', 'ei.url_id')
			.select('ei.id as id', 'ur.url as url')
			.where('ei.id', '>', lastId)
			.orderBy('ei.id', 'asc')
			.limit(chunkSize)) as { id: number; url: string }[];
		if (rows.length === 0) {
			return;
		}
		lastId = rows.at(-1)!.id;
		yield rows.map((row) => row.url);
	}
}
