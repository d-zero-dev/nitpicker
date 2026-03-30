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
