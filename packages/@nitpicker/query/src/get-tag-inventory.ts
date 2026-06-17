import type { TagInventoryEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Returns the site-wide Wappalyzer provider inventory: one row per detected
 * provider, with the count of distinct pages where that provider was found.
 *
 * SQL: `SELECT provider, COUNT(DISTINCT pageId) FROM page_tags GROUP BY provider`.
 * Hits the `page_tags(provider)` index for streaming aggregation (no temp
 * sort). For 500k+ tag rows this typically returns in 1–2s.
 *
 * Result is sorted by page count descending so the highest-coverage
 * technologies lead. Use it as a "what does this site use?" answer for
 * audit kick-offs; drill into specific providers with `listPagesByTag`.
 * @param accessor - The archive accessor to query.
 * @returns Inventory entries sorted by page count desc.
 */
export async function getTagInventory(
	accessor: ArchiveAccessor,
): Promise<TagInventoryEntry[]> {
	const knex = accessor.getKnex();
	const rows = (await knex('page_tags')
		.select('provider')
		.countDistinct({ pageCount: 'pageId' })
		.groupBy('provider')
		.orderBy('pageCount', 'desc')) as Array<{
		provider: string;
		pageCount: number | string;
	}>;
	return rows.map((r) => ({
		provider: r.provider,
		pageCount:
			typeof r.pageCount === 'number' ? r.pageCount : Number.parseInt(r.pageCount, 10),
	}));
}
