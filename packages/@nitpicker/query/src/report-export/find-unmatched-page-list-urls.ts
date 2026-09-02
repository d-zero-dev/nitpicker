import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyEqualityOrInFilter } from '../apply-equality-or-in-filter.js';
import { applyViewerPagesFilters } from '../apply-viewer-pages-filters.js';

/**
 * Finds which of the given normalized URLs did not match a Page List row.
 *
 * Reuses the Page List row set's own base restriction
 * (`applyViewerPagesFilters(qb, { isExternal: false })`, the same one
 * {@link applyPageListRowFilters} applies) rather than a bare `content_items`
 * lookup — so a URL that exists in the archive but falls outside the Page
 * List's scope (an external URL, a PDF, a `content_category` the report
 * never lists) is correctly reported as "not found here" alongside a URL the
 * archive has never seen at all. Distinguishing the two is `query
 * match-urls`'s job, not this function's.
 * @param accessor - The archive accessor to query.
 * @param normalizedUrls - URLs already normalized via
 *   `resolvePageListUrlFilter`/`normalizeArchiveUrl` — comparing raw,
 *   un-normalized input here would produce false negatives.
 * @returns The subset of `normalizedUrls` with no matching Page List row.
 * @example
 * const missing = await findUnmatchedPageListUrls(accessor, urls);
 * if (missing.length > 0) {
 *   console.warn(`${missing.length} of ${urls.length} URL(s) not found`);
 * }
 */
export async function findUnmatchedPageListUrls(
	accessor: ArchiveAccessor,
	normalizedUrls: readonly string[],
): Promise<string[]> {
	if (normalizedUrls.length === 0) {
		return [];
	}
	const qb = accessor.getKnex()('viewer_pages');
	applyViewerPagesFilters(qb, { isExternal: false });
	applyEqualityOrInFilter(qb, 'url', normalizedUrls);
	const rows = await qb.select<{ url: string }[]>('url');
	const found = new Set(rows.map((row) => row.url));
	return normalizedUrls.filter((url) => !found.has(url));
}
