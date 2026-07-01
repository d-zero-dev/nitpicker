import type { MismatchEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { applyListOrder } from './apply-list-order.js';

export interface FindMismatchesOptions {
	limit?: number;
	offset?: number;
	urlPattern?: string;
	sortBy?: 'url' | 'actual' | 'expected';
	sortOrder?: 'asc' | 'desc';
}

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
	limit?: number,
	offset?: number,
): Promise<MismatchEntry[]>;
export async function findMismatches(
	accessor: ArchiveAccessor,
	type: 'canonical' | 'og:title' | 'og:description',
	options: FindMismatchesOptions,
): Promise<{ items: MismatchEntry[]; total: number; limit: number; offset: number }>;
export async function findMismatches(
	accessor: ArchiveAccessor,
	type: 'canonical' | 'og:title' | 'og:description',
	optionsOrLimit?: FindMismatchesOptions | number,
	offsetArgument = 0,
): Promise<
	| MismatchEntry[]
	| { items: MismatchEntry[]; total: number; limit: number; offset: number }
> {
	const knex = accessor.getKnex();
	const pagedMode = typeof optionsOrLimit === 'object';
	const options = pagedMode ? optionsOrLimit : {};
	const limit = pagedMode ? (options.limit ?? 100) : (optionsOrLimit ?? 100);
	const offset = pagedMode ? (options.offset ?? 0) : offsetArgument;
	const sortBy = options.sortBy ?? 'url';
	const sortOrder = options.sortOrder ?? 'asc';
	const useUrlSort = options.sortBy != null;

	const baseQuery = knex('pages')
		.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
		.whereNull('redirectDestId');
	if (options.urlPattern) {
		baseQuery.where('url', 'like', options.urlPattern);
	}

	switch (type) {
		case 'canonical': {
			const query = baseQuery
				.clone()
				.whereNotNull('canonical')
				.whereNot('canonical', '')
				.whereRaw('canonical != url');
			const total = await count(query, 'id');
			const rows = await applyListOrder(
				query.select('url', 'canonical'),
				knex,
				sortBy,
				sortOrder,
				{
					url: { column: '"pages"."url"', type: useUrlSort ? 'url' : 'plain' },
					actual: { column: '"pages"."url"', type: useUrlSort ? 'url' : 'plain' },
					expected: { column: '"pages"."canonical"', type: 'url' },
				},
			)
				.limit(limit)
				.offset(offset);

			const items = rows.map((row: { url: string; canonical: string | null }) => ({
				url: row.url,
				type: 'canonical' as const,
				actual: row.url,
				expected: row.canonical,
			}));
			return pagedMode ? { items, total, limit, offset } : items;
		}
		case 'og:title': {
			const query = baseQuery
				.clone()
				.whereNotNull('og_title')
				.whereNot('og_title', '')
				.whereNotNull('title')
				.whereNot('title', '')
				.whereRaw('og_title != title');
			const total = await count(query, 'id');
			const rows = await applyListOrder(
				query.select('url', 'title', 'og_title'),
				knex,
				sortBy,
				sortOrder,
				{
					url: { column: '"pages"."url"', type: useUrlSort ? 'url' : 'plain' },
					actual: { column: '"pages"."og_title"' },
					expected: { column: '"pages"."title"' },
				},
			)
				.limit(limit)
				.offset(offset);

			const items = rows.map(
				(row: { url: string; title: string | null; og_title: string | null }) => ({
					url: row.url,
					type: 'og:title' as const,
					actual: row.og_title,
					expected: row.title,
				}),
			);
			return pagedMode ? { items, total, limit, offset } : items;
		}
		case 'og:description': {
			const query = baseQuery
				.clone()
				.whereNotNull('og_description')
				.whereNot('og_description', '')
				.whereNotNull('description')
				.whereNot('description', '')
				.whereRaw('og_description != description');
			const total = await count(query, 'id');
			const rows = await applyListOrder(
				query.select('url', 'description', 'og_description'),
				knex,
				sortBy,
				sortOrder,
				{
					url: { column: '"pages"."url"', type: useUrlSort ? 'url' : 'plain' },
					actual: { column: '"pages"."og_description"' },
					expected: { column: '"pages"."description"' },
				},
			)
				.limit(limit)
				.offset(offset);

			const items = rows.map(
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
			return pagedMode ? { items, total, limit, offset } : items;
		}
	}
}

/**
 * Counts the same filtered mismatch query without carrying selected columns.
 * @param query - Filtered mismatch query.
 * @param column - Primary key column to count.
 */
async function count(query: Knex.QueryBuilder, column: string) {
	const result = (await query.clone().clearSelect().count(`${column} as total`)) as {
		total: number;
	}[];
	return Number(result[0]?.total ?? 0);
}
