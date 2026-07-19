import type { GetResourceReferrersOptions, ResourceReferrerResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Parses an opaque referrers cursor (the last-seen `pageId`, plain decimal).
 * @param cursor - The opaque cursor string from the request, if any.
 * @returns The `pageId` to seek forward from.
 */
function parseReferrersCursor(cursor: string | undefined): number {
	if (!cursor) {
		return 0;
	}
	const parsed = Number(cursor);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Retrieves which pages reference a specific resource URL — a bounded,
 * cursor-paginated read.
 *
 * 0.13: reads 0.13 `resource_ref_edges` (composite PK
 * `(resource_id, page_id)`) joined to `content_items` + `url_refs` for the
 * referrer page URL, and resolves the resource by URL via
 * `resource_items JOIN url_refs`.
 * @param accessor - The archive accessor to query.
 * @param options - The resource URL to look up, plus pagination options.
 * @returns The resource URL and a bounded window of pages that reference
 *   it, or `null` if the resource URL is not found.
 * @example
 * let cursor: string | undefined;
 * do {
 *   const result = await getResourceReferrers(accessor, {
 *     resourceUrl: 'https://example.com/style.css',
 *     limit: 100,
 *     cursor,
 *   });
 *   if (!result) break; // unknown resource URL
 *   console.log(result.pageUrls);
 *   cursor = result.nextCursor ?? undefined;
 * } while (cursor);
 */
export async function getResourceReferrers(
	accessor: ArchiveAccessor,
	options: GetResourceReferrersOptions,
): Promise<ResourceReferrerResult | null> {
	const { resourceUrl } = options;
	const limit = options.limit ?? 100;
	const knex = accessor.getKnex();

	const [resource] = await knex('resource_items as ri')
		.join('url_refs as ur', 'ur.id', 'ri.url_id')
		.select('ri.id as id')
		.where('ur.url', resourceUrl)
		.limit(1);

	if (!resource) {
		return null;
	}

	const afterPageId = parseReferrersCursor(options.cursor);

	const [totalResult, rows] = await Promise.all([
		knex('resource_ref_edges')
			.where('resource_id', resource.id)
			.count<{ count: string }[]>({ count: '*' }),
		knex('resource_ref_edges as rre')
			.join('content_items as ci', 'ci.id', 'rre.page_id')
			.join('url_refs as page_ur', 'page_ur.id', 'ci.url_id')
			.select('page_ur.url as url', 'rre.page_id as pageId')
			.where('rre.resource_id', resource.id)
			.where('rre.page_id', '>', afterPageId)
			.orderBy('rre.page_id', 'asc')
			.limit(limit + 1) as Promise<{ url: string; pageId: number }[]>,
	]);

	const hasMore = rows.length > limit;
	const window = rows.slice(0, limit);
	const lastRow = window.at(-1);

	return {
		resourceUrl,
		pageUrls: window.map((row) => row.url),
		total: Number(totalResult[0]?.count ?? 0),
		nextCursor: hasMore && lastRow ? String(lastRow.pageId) : null,
	};
}
