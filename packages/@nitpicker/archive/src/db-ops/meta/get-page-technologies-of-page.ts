import type { PageTechnologyRow } from '../../meta/types.js';
import type { Knex } from 'knex';

/**
 * Retrieves all `page_technologies` rows for the given page id — the
 * confidence-combined roll-up (one row per detected technology).
 *
 * Read-side counterpart to `insertTechnologies`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId
 */
export async function getPageTechnologiesOfPage(
	knex: Knex,
	pageId: number,
): Promise<PageTechnologyRow[]> {
	return knex
		.select<
			PageTechnologyRow[]
		>('id', 'pageId', 'technology', 'category', 'version', 'confidence', 'signalCount')
		.from('page_technologies')
		.where('pageId', pageId)
		.orderBy('confidence', 'desc');
}
