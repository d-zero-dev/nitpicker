import type { GetResourceReferrersOptions, ResourceReferrerResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Parses an opaque referrers cursor (the last-seen `pageId`, plain decimal —
 * no JSON envelope needed since this query has no filter/sort variability
 * to invalidate a stale cursor against, unlike the keyset cursors in
 * `viewer-resources-cursor/`). An invalid or missing cursor falls back to
 * `0` (start from the beginning) rather than throwing — `resources-referrers.pageId`
 * is always a positive foreign key, so `pageId > 0` matches every row.
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
 * cursor-paginated read directly against the write-model `resources-referrers`
 * table.
 *
 * Independent of the viewer read model: `resources-referrers` already
 * carries a `(resourceId, pageId)` unique index (see `init-schema.ts`), so
 * `WHERE resourceId = ? AND pageId > ? ORDER BY pageId LIMIT ?` and the
 * `total` count (`WHERE resourceId = ?`) are both index-covered seeks
 * regardless of archive size — there is no expensive aggregation here for a
 * read model to precompute, unlike `listResources`/`listUnusedResources`.
 * @param accessor - The archive accessor to query.
 * @param options - The resource URL to look up, plus pagination options.
 * @returns The resource URL and a bounded window of pages that reference
 *   it, or `null` if the resource URL is not found.
 * @example
 * const page1 = await getResourceReferrers(accessor, {
 *   resourceUrl: 'https://example.com/shared.css',
 *   limit: 100,
 * });
 * const page2 = page1?.nextCursor
 *   ? await getResourceReferrers(accessor, {
 *       resourceUrl: 'https://example.com/shared.css',
 *       limit: 100,
 *       cursor: page1.nextCursor,
 *     })
 *   : null;
 */
export async function getResourceReferrers(
	accessor: ArchiveAccessor,
	options: GetResourceReferrersOptions,
): Promise<ResourceReferrerResult | null> {
	const { resourceUrl } = options;
	const limit = options.limit ?? 100;
	const knex = accessor.getKnex();

	const [resource] = await knex('resources')
		.select('id')
		.where('url', resourceUrl)
		.limit(1);

	if (!resource) {
		return null;
	}

	const afterPageId = parseReferrersCursor(options.cursor);

	const [totalResult, rows] = await Promise.all([
		knex('resources-referrers')
			.where('resourceId', resource.id)
			.count<{ count: string }[]>({ count: '*' }),
		knex('resources-referrers')
			.select('pages.url as url', 'resources-referrers.pageId as pageId')
			.join('pages', 'pages.id', '=', 'resources-referrers.pageId')
			.where('resources-referrers.resourceId', resource.id)
			.where('resources-referrers.pageId', '>', afterPageId)
			.orderBy('resources-referrers.pageId', 'asc')
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
