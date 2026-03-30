import type { Knex } from 'knex';

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
