import type { TechnologyInventoryEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Returns the site-wide technology inventory: one row per detected
 * technology, with the count of distinct pages where it was found and its
 * mean confidence.
 *
 * SQL: `SELECT technology, COUNT(DISTINCT pageId), AVG(confidence) FROM
 * page_technologies GROUP BY technology`, plus a correlated subquery for
 * `category` (see below). Hits the `page_technologies(technology)` index
 * for streaming aggregation.
 *
 * `category` picks the first non-null category by `page_technologies.id`
 * (insertion order) — deliberately NOT `MIN(category)`, which would pick
 * the alphabetically-smallest category string instead and diverge from
 * `TechnologyInventoryEntry.category`'s documented "first non-null"
 * contract (and from `buildTechnologySummaryRows`, the read model's
 * equivalent, which implements true first-non-null via JS iteration order).
 *
 * Result is sorted by page count descending so the highest-coverage
 * technologies lead. Use it as a "what does this site use?" answer for
 * audit kick-offs; drill into specific technologies with
 * `listPagesByTechnology`.
 * @param accessor - The archive accessor to query.
 * @returns Inventory entries sorted by page count desc.
 * @example
 * const inventory = await getTechnologyInventory(accessor);
 * const nextjs = inventory.find((entry) => entry.technology === 'Next.js');
 * console.log(nextjs?.pageCount, nextjs?.avgConfidence);
 */
export async function getTechnologyInventory(
	accessor: ArchiveAccessor,
): Promise<TechnologyInventoryEntry[]> {
	const knex = accessor.getKnex();
	const rows = (await knex('page_technologies')
		.select('technology')
		.select(
			knex.raw(
				'(select pt2.category from page_technologies as pt2 ' +
					'where pt2.technology = page_technologies.technology and pt2.category is not null ' +
					'order by pt2.id asc limit 1) as category',
			),
		)
		.countDistinct({ pageCount: 'pageId' })
		.avg({ avgConfidence: 'confidence' })
		.groupBy('technology')
		.orderBy('pageCount', 'desc')) as Array<{
		technology: string;
		category: string | null;
		pageCount: number | string;
		avgConfidence: number | string;
	}>;
	return rows.map((r) => ({
		technology: r.technology,
		category: r.category,
		pageCount:
			typeof r.pageCount === 'number' ? r.pageCount : Number.parseInt(r.pageCount, 10),
		avgConfidence: Math.round(
			typeof r.avgConfidence === 'number'
				? r.avgConfidence
				: Number.parseFloat(r.avgConfidence),
		),
	}));
}
