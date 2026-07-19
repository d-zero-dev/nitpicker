import type { DB_Page, PageFilter } from '../../../types.js';
import type { Knex } from 'knex';

import { buildPageQuery } from './build-page-query.js';
import { reconstructPageRows } from './reconstruct-page-rows.js';

/**
 * Retrieves pages from the database with optional filtering, pagination via offset and limit.
 * @param knex - Knex query builder connected to the archive DB.
 * @param filter - An optional {@link PageFilter} to narrow results by content type and origin.
 * @param offset - The number of rows to skip. Defaults to `0`.
 * @param limit - The maximum number of rows to return. Defaults to `100000`.
 * @returns An array of reconstructed {@link DB_Page} rows.
 */
export async function getPages(
	knex: Knex,
	filter?: PageFilter,
	offset = 0,
	limit = 100_000,
): Promise<DB_Page[]> {
	const q = buildPageQuery(knex);
	switch (filter) {
		case 'page': {
			q.where('ctr.raw', 'text/html').andWhere('ci.is_target', 1);
			break;
		}
		case 'page-included-no-target': {
			q.where('ctr.raw', 'text/html');
			break;
		}
		case 'external-page': {
			q.where('ctr.raw', 'text/html').andWhere('ci.is_external', 1);
			break;
		}
		case 'internal-page': {
			q.where('ctr.raw', 'text/html').andWhere('ci.is_external', 0);
			break;
		}
		case 'no-page': {
			q.where((qb) => {
				qb.whereNull('ctr.raw').orWhereNot('ctr.raw', 'text/html');
			});
			break;
		}
		case 'external-no-page': {
			q.where((qb) => {
				qb.whereNull('ctr.raw').orWhereNot('ctr.raw', 'text/html');
			}).andWhere('ci.is_external', 1);
			break;
		}
		case 'internal-no-page': {
			q.where((qb) => {
				qb.whereNull('ctr.raw').orWhereNot('ctr.raw', 'text/html');
			}).andWhere('ci.is_external', 0);
			break;
		}
	}
	const rows = await q.limit(limit).offset(offset);
	return reconstructPageRows(knex, rows);
}
