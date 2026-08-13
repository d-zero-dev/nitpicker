import type { TechnologyInventoryEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Reads the site-wide technology inventory from the precomputed
 * `viewer_technology_summary` read-model table (built by
 * `buildTechnologySummaryRows`) — the fast-path counterpart of
 * `getTechnologyInventory`'s live `GROUP BY` query. Callers are responsible
 * for confirming the read model is current (see `isViewerReadModelCurrent`)
 * before calling this — it assumes `viewer_technology_summary` exists and
 * trusts its content.
 * @param accessor - The archive accessor to query.
 * @returns Inventory entries sorted by page count desc.
 * @example
 * const inventory = await getViewerTechnologyInventory(accessor);
 */
export async function getViewerTechnologyInventory(
	accessor: ArchiveAccessor,
): Promise<TechnologyInventoryEntry[]> {
	const knex = accessor.getKnex();
	const rows: Array<{
		technology: string;
		category: string | null;
		pageCount: number;
		avgConfidence: number;
	}> = await knex('viewer_technology_summary')
		.select(
			'technology',
			'category',
			'detected_page_count as pageCount',
			'avg_confidence as avgConfidence',
		)
		.orderBy('pageCount', 'desc');
	return rows;
}
