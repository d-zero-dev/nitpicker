import type { ListPagesByTagOptions, PageCountResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Returns the number of distinct pages that have a Wappalyzer tag matching
 * the given provider (and optionally a specific external ID).
 *
 * Lightweight sibling of {@link import('./list-pages-by-tag.js').listPagesByTag}.
 * Designed for MCP / LLM consumers to size-check up front: "how many pages
 * have GTM?" should not require pulling the whole list. Hits the
 * `page_tags(provider, externalId)` compound index for sub-second response
 * even on million-row archives.
 * @param accessor - The archive accessor to query.
 * @param options - `provider` (required), optional `externalId`.
 * @returns `{ pageCount }`.
 */
export async function countPagesByTag(
	accessor: ArchiveAccessor,
	options: Pick<ListPagesByTagOptions, 'provider' | 'externalId'>,
): Promise<PageCountResult> {
	const knex = accessor.getKnex();
	let q = knex('page_tags')
		.countDistinct({ pageCount: 'pageId' })
		.where('provider', options.provider);
	if (options.externalId !== undefined) {
		q = q.where('externalId', options.externalId);
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
