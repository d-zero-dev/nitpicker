import type { DuplicateEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Finds pages with duplicate title or description metadata.
 * Uses SQL GROUP BY and HAVING to efficiently detect duplicates
 * at the database level.
 * @param accessor - The archive accessor to query.
 * @param field - The metadata field to check for duplicates.
 * @param limit - Maximum number of duplicate groups to return. Defaults to 50.
 * @returns An array of duplicate entries with the shared value and matching URLs.
 */
export async function findDuplicates(
	accessor: ArchiveAccessor,
	field: 'title' | 'description' = 'title',
	limit: number = 50,
): Promise<DuplicateEntry[]> {
	const knex = accessor.getKnex();

	const column = field === 'title' ? 'title' : 'description';

	const duplicateValues = (await knex('pages')
		.select(column)
		.count('id as cnt')
		.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
		.whereNull('redirectDestId')
		.whereNotNull(column)
		.whereNot(column, '')
		.groupBy(column)
		.having('cnt', '>', 1)
		.orderBy('cnt', 'desc')
		.limit(limit)) as Record<string, string | number>[];

	const results: DuplicateEntry[] = [];
	for (const row of duplicateValues) {
		const value = row[column] as string;
		const pages = (await knex('pages')
			.select('url')
			.where({
				[column]: value,
				scraped: 1,
				isExternal: 0,
			})
			.whereNull('redirectDestId')) as { url: string }[];

		results.push({
			field,
			value,
			urls: pages.map((p) => p.url),
			count: Number(row.cnt),
		});
	}

	return results;
}
