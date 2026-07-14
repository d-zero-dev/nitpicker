import type { MismatchEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { applyListOrder } from './apply-list-order.js';
import { ensureUrlSortTempTable } from './url-sort-temp-table.js';

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
 *
 * 0.13: reads through 0.13 `content_items` + `page_meta`;
 * comparisons are integer-id equalities (`page_meta.canonical_url_id !=
 * content_items.url_id`, `page_meta.og_title_text_id !=
 * page_meta.title_text_id`, etc.), which are equivalent to the pre-6 string
 * comparisons because `url_refs`/`text_refs` are unique per URL/text.
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
	const needsUrlSortTempTable = useUrlSort && (type === 'canonical' || sortBy === 'url');
	if (needsUrlSortTempTable) {
		await ensureUrlSortTempTable(accessor);
	}

	const baseQuery = knex('content_items as ci')
		.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
		.join('page_meta as pm', 'pm.page_id', 'ci.id')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.where({ 'ci.scraped': 1, 'ci.is_external': 0, 'ctr.raw': 'text/html' })
		.whereNull('ci.redirect_dest_id');
	if (options.urlPattern) {
		baseQuery.where('ur.url', 'like', options.urlPattern);
	}

	switch (type) {
		case 'canonical': {
			const query = baseQuery
				.clone()
				.join('url_refs as canonical_ur', 'canonical_ur.id', 'pm.canonical_url_id')
				.whereNotNull('pm.canonical_url_id')
				.whereNot('canonical_ur.url', '')
				.whereRaw('"pm"."canonical_url_id" != "ci"."url_id"');
			const total = await count(query, 'ci.id');
			const rows = await applyListOrder(
				query.select('ur.url as url', 'canonical_ur.url as canonical'),
				knex,
				sortBy,
				sortOrder,
				{
					url: { column: '"ur"."url"', type: useUrlSort ? 'url' : 'plain' },
					actual: { column: '"ur"."url"', type: useUrlSort ? 'url' : 'plain' },
					expected: { column: '"canonical_ur"."url"', type: 'url' },
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
				.join('text_refs as og_title_ref', 'og_title_ref.id', 'pm.og_title_text_id')
				.join('text_refs as title_ref', 'title_ref.id', 'pm.title_text_id')
				.whereNotNull('pm.og_title_text_id')
				.whereNot('og_title_ref.text', '')
				.whereNotNull('pm.title_text_id')
				.whereNot('title_ref.text', '')
				.whereRaw('"pm"."og_title_text_id" != "pm"."title_text_id"');
			const total = await count(query, 'ci.id');
			const rows = await applyListOrder(
				query.select(
					'ur.url as url',
					'title_ref.text as title',
					'og_title_ref.text as og_title',
				),
				knex,
				sortBy,
				sortOrder,
				{
					url: { column: '"ur"."url"', type: useUrlSort ? 'url' : 'plain' },
					actual: { column: '"og_title_ref"."text"' },
					expected: { column: '"title_ref"."text"' },
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
				.join('text_refs as og_desc_ref', 'og_desc_ref.id', 'pm.og_description_text_id')
				.join('text_refs as desc_ref', 'desc_ref.id', 'pm.description_text_id')
				.whereNotNull('pm.og_description_text_id')
				.whereNot('og_desc_ref.text', '')
				.whereNotNull('pm.description_text_id')
				.whereNot('desc_ref.text', '')
				.whereRaw('"pm"."og_description_text_id" != "pm"."description_text_id"');
			const total = await count(query, 'ci.id');
			const rows = await applyListOrder(
				query.select(
					'ur.url as url',
					'desc_ref.text as description',
					'og_desc_ref.text as og_description',
				),
				knex,
				sortBy,
				sortOrder,
				{
					url: { column: '"ur"."url"', type: useUrlSort ? 'url' : 'plain' },
					actual: { column: '"og_desc_ref"."text"' },
					expected: { column: '"desc_ref"."text"' },
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
