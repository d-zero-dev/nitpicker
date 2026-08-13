import type { ListPagesByTechnologyOptions, PageCountResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Returns the number of distinct pages where the given technology was
 * detected at or above an optional minimum confidence.
 *
 * Lightweight sibling of {@link import('./list-pages-by-technology.js').listPagesByTechnology}.
 * Designed for MCP / LLM consumers to size-check up front: "how many pages
 * use Next.js?" should not require pulling the whole list.
 * @param accessor - The archive accessor to query.
 * @param options - `technology` (required), optional `minConfidence` / `signalType`.
 * @returns `{ pageCount }`.
 */
export async function countPagesByTechnology(
	accessor: ArchiveAccessor,
	options: Pick<
		ListPagesByTechnologyOptions,
		'technology' | 'minConfidence' | 'signalType'
	>,
): Promise<PageCountResult> {
	const knex = accessor.getKnex();
	let q = knex('page_technologies')
		.countDistinct({ pageCount: 'pageId' })
		.where('technology', options.technology);
	if (options.minConfidence !== undefined) {
		q = q.where('confidence', '>=', options.minConfidence);
	}
	if (options.signalType !== undefined) {
		q = q.whereExists((subquery) =>
			subquery
				.select(1)
				.from('technology_signals')
				.where('technology_signals.pageId', '=', knex.raw('page_technologies.pageId'))
				.where(
					'technology_signals.technology',
					'=',
					knex.raw('page_technologies.technology'),
				)
				.where('technology_signals.signalType', options.signalType!),
		);
	}
	const [row] = (await q) as Array<{ pageCount: number | string }>;
	if (!row) return { pageCount: 0 };
	return {
		pageCount:
			typeof row.pageCount === 'number'
				? row.pageCount
				: Number.parseInt(row.pageCount, 10),
	};
}
