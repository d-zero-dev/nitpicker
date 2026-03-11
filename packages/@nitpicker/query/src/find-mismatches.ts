import type { MismatchEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Finds metadata mismatches in the archive: canonical URL != page URL,
 * og:title != title, og:description != description.
 * Uses SQL WHERE conditions to detect mismatches at the database level.
 * @param accessor - The archive accessor to query.
 * @param type - The type of mismatch to search for.
 * @param limit - Maximum number of results. Defaults to 100.
 * @param offset - Number of results to skip. Defaults to 0.
 * @returns An array of mismatch entries.
 */
export async function findMismatches(
	accessor: ArchiveAccessor,
	type: 'canonical' | 'og:title' | 'og:description',
	limit: number = 100,
	offset: number = 0,
): Promise<MismatchEntry[]> {
	const knex = accessor.getKnex();

	const baseQuery = knex('pages')
		.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
		.whereNull('redirectDestId');

	switch (type) {
		case 'canonical': {
			const rows = await baseQuery
				.clone()
				.select('url', 'canonical')
				.whereNotNull('canonical')
				.whereNot('canonical', '')
				.whereRaw('canonical != url')
				.limit(limit)
				.offset(offset);

			return rows.map((row: { url: string; canonical: string | null }) => ({
				url: row.url,
				type: 'canonical' as const,
				actual: row.url,
				expected: row.canonical,
			}));
		}
		case 'og:title': {
			const rows = await baseQuery
				.clone()
				.select('url', 'title', 'og_title')
				.whereNotNull('og_title')
				.whereNot('og_title', '')
				.whereNotNull('title')
				.whereNot('title', '')
				.whereRaw('og_title != title')
				.limit(limit)
				.offset(offset);

			return rows.map(
				(row: { url: string; title: string | null; og_title: string | null }) => ({
					url: row.url,
					type: 'og:title' as const,
					actual: row.og_title,
					expected: row.title,
				}),
			);
		}
		case 'og:description': {
			const rows = await baseQuery
				.clone()
				.select('url', 'description', 'og_description')
				.whereNotNull('og_description')
				.whereNot('og_description', '')
				.whereNotNull('description')
				.whereNot('description', '')
				.whereRaw('og_description != description')
				.limit(limit)
				.offset(offset);

			return rows.map(
				(row: {
					url: string;
					description: string | null;
					og_description: string | null;
				}) => ({
					url: row.url,
					type: 'og:description' as const,
					actual: row.og_description,
					expected: row.description,
				}),
			);
		}
	}
}
