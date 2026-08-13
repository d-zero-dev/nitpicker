import type { TechnologyDirectoryStatsEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Returns the directory × technology distribution across the whole
 * archive — the `/technologies` view's matrix panel — from the precomputed
 * `viewer_technology_directory_stats` table.
 *
 * No live fallback exists for this feature, the same trade-off
 * `getDirectoryTree` accepts: `isViewerReadModelCurrent` is checked (not
 * just table existence), so an archive whose read model predates this
 * table, or has none built yet, returns `[]` instead of throwing a "no
 * such table" error.
 * @param accessor - The archive accessor to query.
 * @returns Every (directory, technology) bucket with a nonzero count,
 *   page count descending. Returns `[]` when the read model has not been
 *   built, or was built under a stale schema version.
 */
export async function getTechnologyDirectoryDistribution(
	accessor: ArchiveAccessor,
): Promise<TechnologyDirectoryStatsEntry[]> {
	if (!(await isViewerReadModelCurrent(accessor))) {
		return [];
	}
	const knex = accessor.getKnex();
	return knex('viewer_technology_directory_stats')
		.select(
			'root_key as rootKey',
			'directory as directory',
			'technology as technology',
			'page_count as pageCount',
		)
		.orderBy('page_count', 'desc');
}
