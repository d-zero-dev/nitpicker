import type { TechnologySignalRow } from '../../meta/types.js';
import type { Knex } from 'knex';

/**
 * Retrieves all `technology_signals` rows for the given page id — the raw,
 * per-signal evidence behind its `page_technologies` roll-up.
 *
 * Read-side counterpart to `insertTechnologies`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId
 */
export async function getTechnologySignalsOfPage(
	knex: Knex,
	pageId: number,
): Promise<TechnologySignalRow[]> {
	return knex
		.select<
			TechnologySignalRow[]
		>('id', 'pageId', 'technology', 'signalType', 'evidence', 'weight')
		.from('technology_signals')
		.where('pageId', pageId)
		.orderBy('id', 'asc');
}
