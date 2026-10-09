import type { Knex } from 'knex';

/**
 * Returns a Knex subquery builder that selects page IDs with pagination,
 * ordered by `content_items.crawl_order` (nulls last), excluding
 * redirected pages.
 * @param limit - The maximum number of page IDs to return.
 * @param offset - The number of page IDs to skip before returning results.
 */
export function limitedPageIds(limit: number, offset: number) {
	return async (qb: Knex.QueryBuilder<Record<string, unknown>, unknown>) => {
		await qb
			.select('id')
			.from('content_items')
			.orderByRaw('`crawl_order` ASC NULLS LAST')
			.whereNull('redirect_dest_id')
			.limit(limit)
			.offset(offset);
	};
}
