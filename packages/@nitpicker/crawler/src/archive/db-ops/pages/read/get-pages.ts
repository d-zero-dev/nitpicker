import type { DB_Page, PageFilter } from '../../../types.js';
import type { Knex } from 'knex';

/**
 * Retrieves pages from the database with optional filtering, pagination via offset and limit.
 * @param knex - Knex query builder connected to the archive DB.
 * @param filter - An optional {@link PageFilter} to narrow results by content type and origin.
 * @param offset - The number of rows to skip. Defaults to `0`.
 * @param limit - The maximum number of rows to return. Defaults to `100000`.
 * @returns An array of raw {@link DB_Page} rows.
 */
export async function getPages(
	knex: Knex,
	filter?: PageFilter,
	offset = 0,
	limit = 100_000,
): Promise<DB_Page[]> {
	const q = knex.select('*').from<DB_Page>('pages');
	switch (filter) {
		case 'page': {
			return q
				.where({
					contentType: 'text/html',
					isTarget: 1,
				})
				.limit(limit)
				.offset(offset);
		}
		case 'page-included-no-target': {
			return q
				.where({
					contentType: 'text/html',
				})
				.limit(limit)
				.offset(offset);
		}
		case 'external-page': {
			return q
				.where({
					contentType: 'text/html',
					isExternal: 1,
				})
				.limit(limit)
				.offset(offset);
		}
		case 'internal-page': {
			return q
				.where({
					contentType: 'text/html',
					isExternal: 0,
				})
				.limit(limit)
				.offset(offset);
		}
		case 'no-page': {
			return q
				.whereNull('contentType')
				.orWhereNot({
					contentType: 'text/html',
				})
				.limit(limit)
				.offset(offset);
		}
		case 'external-no-page': {
			return q
				.where((qb) => {
					qb.whereNull('contentType').orWhereNot({
						contentType: 'text/html',
					});
				})
				.andWhere({
					isExternal: 1,
				})
				.limit(limit)
				.offset(offset);
		}
		case 'internal-no-page': {
			return q
				.where((qb) => {
					qb.whereNull('contentType').orWhereNot({
						contentType: 'text/html',
					});
				})
				.andWhere({
					isExternal: 0,
				})
				.limit(limit)
				.offset(offset);
		}
	}
	return q.limit(limit).offset(offset);
}
