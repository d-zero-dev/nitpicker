import type { ListPagesByJsonLdTypeOptions, PageCountResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Returns the number of distinct pages that have at least one JSON-LD entry
 * with the given top-level `@type`.
 *
 * Lightweight sibling of `listPagesByJsonLdType`. Hits the
 * `page_jsonld(type, pageId)` compound index for streaming aggregation.
 * @param accessor - The archive accessor to query.
 * @param options - `type` (required).
 * @returns `{ pageCount }`.
 */
export async function countPagesByJsonLdType(
	accessor: ArchiveAccessor,
	options: Pick<ListPagesByJsonLdTypeOptions, 'type'>,
): Promise<PageCountResult> {
	const knex = accessor.getKnex();
	const [row] = (await knex('page_jsonld')
		.countDistinct({ pageCount: 'pageId' })
		.where('type', options.type)) as Array<{ pageCount: number | string }>;
	if (!row) return { pageCount: 0 };
	return {
		pageCount:
			typeof row.pageCount === 'number'
				? row.pageCount
				: Number.parseInt(row.pageCount, 10),
	};
}
