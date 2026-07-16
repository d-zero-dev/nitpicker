import type { Knex } from 'knex';

/**
 * Returns a Knex subquery builder that joins `content_items` with their
 * redirect destinations (resolved via `url_refs` for both sides). When
 * `includeNull` is true, also includes pages without redirects
 * (self-referencing).
 * @param includeNull - Whether to include non-redirected pages in the result. Defaults to `true`.
 */
export function redirectTable(includeNull = true) {
	return async (qb: Knex.QueryBuilder<Record<string, unknown>, unknown>) => {
		const list = qb
			.select('A.id as fromId', 'A_url.url as from', 'B_url.url as to', 'B.id as toId')
			.from('content_items as A')
			.join('url_refs as A_url', 'A.url_id', 'A_url.id')
			.join('content_items as B', (j) => {
				j.on('A.redirect_dest_id', '=', 'B.id').andOnNotNull('A.redirect_dest_id');
			})
			.join('url_refs as B_url', 'B.url_id', 'B_url.id');
		if (includeNull) {
			await list.union(async (qb) => {
				await qb
					.select(
						'A.id as fromId',
						'A_url.url as from',
						'A_url.url as to',
						'A.id as toId',
					)
					.from('content_items as A')
					.join('url_refs as A_url', 'A.url_id', 'A_url.id')
					.whereNull('A.redirect_dest_id');
			});
		}
	};
}
