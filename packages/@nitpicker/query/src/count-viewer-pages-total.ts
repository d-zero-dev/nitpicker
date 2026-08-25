import type { ListViewerPagesOptions } from './types.js';
import type { Knex } from 'knex';

import { applyViewerPagesFilters } from './apply-viewer-pages-filters.js';

/**
 * Resolves the total matching row count for `/api/pages`'s `viewer_pages`
 * fast path: a live `COUNT(*)` against the narrow, indexed `viewer_pages`
 * table (never the wide write-model `pages` table), with the same filters
 * the id-resolution query applies.
 *
 * Deliberately does NOT special-case the `viewer_query_profiles` `'default'`
 * row `buildViewerReadModel` seeds: that row counts every `viewer_pages` row
 * unconditionally (by design — see that function's docs), which is a
 * different quantity than "no explicit filter passed", since the latter
 * still applies the implicit `content_category IN ('html', 'unknown')` base
 * restriction that mirrors `listPages`'s default view. Reusing the seeded
 * total for that case would silently overcount whenever the archive also
 * has non-HTML pages (PDFs, images, …).
 * @param knex - The archive's Knex instance.
 * @param options - The caller's filter/sort options.
 * @returns The total number of matching rows.
 * @example
 * const total = await countViewerPagesTotal(knex, { isExternal: false });
 */
export async function countViewerPagesTotal(
	knex: Knex,
	options: ListViewerPagesOptions,
): Promise<number> {
	const qb = knex('viewer_pages');
	applyViewerPagesFilters(qb, options);
	const result = await qb.count<{ count: string }[]>({ count: '*' });
	return Number(result[0]?.count ?? 0);
}
