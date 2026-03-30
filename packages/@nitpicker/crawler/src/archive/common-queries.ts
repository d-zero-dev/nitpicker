import type { DB_Page } from './types.js';
import type { Knex } from 'knex';

/**
 * Returns a Knex subquery builder that selects page IDs with pagination,
 * ordered by the `order` column (nulls last), excluding redirected pages.
 * @param limit - The maximum number of page IDs to return.
 * @param offset - The number of page IDs to skip before returning results.
 */
export function limitedPageIds(limit: number, offset: number) {
	return async (qb: Knex.QueryBuilder<Record<string, unknown>, unknown>) => {
		await qb
			.select('id')
			.from<DB_Page>('pages')
			.orderByRaw('`order` ASC NULLS LAST')
			.whereNull('redirectDestId')
			.limit(limit)
			.offset(offset);
	};
}

/**
 * Returns a Knex subquery builder that joins pages with their redirect destinations.
 * When `includeNull` is true, also includes pages without redirects (self-referencing).
 * @param includeNull - Whether to include non-redirected pages in the result. Defaults to `true`.
 */
export function redirectTable(includeNull = true) {
	return async (qb: Knex.QueryBuilder<Record<string, unknown>, unknown>) => {
		const list = qb
			.select('A.id as fromId', 'A.url as from', 'B.url as to', 'B.id as toId')
			.from('pages as A')
			.join('pages as B', (j) => {
				j.on('A.redirectDestId', '=', 'B.id').andOnNotNull('A.redirectDestId');
			});
		if (includeNull) {
			await list.union(async (qb) => {
				await qb
					.select('A.id as fromId', 'A.url as from', 'A.url as to', 'A.id as toId')
					.from('pages as A')
					.whereNull('A.redirectDestId');
			});
		}
	};
}
