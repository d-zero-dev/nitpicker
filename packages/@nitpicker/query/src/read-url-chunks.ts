import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Reads a table's `url` column in fixed-size chunks using `id`-based keyset
 * pagination (`WHERE id > :last ORDER BY id LIMIT :size`) instead of
 * `OFFSET`, so each read is a direct index seek rather than an
 * O(offset) scan.
 *
 * Both `pages` and `resources` use `t.increments('id')` as their primary
 * key, which SQLite implements as a `rowid` alias — a plain integer
 * comparison, no extra index needed.
 * @param accessor - The opened archive accessor.
 * @param table - The table to read URLs from.
 * @param chunkSize - Maximum rows per chunk.
 * @yields {string[]} Each chunk's `url` column values, at most `chunkSize` long.
 * @example
 * for await (const urls of readUrlChunks(accessor, 'pages', 50_000)) {
 *   // urls.length <= 50_000
 * }
 */
export async function* readUrlChunks(
	accessor: ArchiveAccessor,
	table: 'pages' | 'resources',
	chunkSize: number,
): AsyncGenerator<string[]> {
	const knex = accessor.getKnex();
	let lastId = 0;
	for (;;) {
		const rows = (await knex(table)
			.select('id', 'url')
			.where('id', '>', lastId)
			.orderBy('id', 'asc')
			.limit(chunkSize)) as { id: number; url: string }[];
		if (rows.length === 0) {
			return;
		}
		lastId = rows.at(-1)!.id;
		yield rows.map((row) => row.url);
	}
}
