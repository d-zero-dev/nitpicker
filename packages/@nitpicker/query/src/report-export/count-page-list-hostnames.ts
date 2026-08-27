import type { PageListRowFilterOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyPageListRowFilters } from './apply-page-list-row-filters.js';

/**
 * Counts the distinct hosts among the pages `streamPageListRows` would
 * yield.
 *
 * Answers "is this a multi-root archive, as far as this report's row set is
 * concerned?" in one query — a report that shows a URL column can drop the
 * host from every row (or skip a per-host grouping entirely) when the answer
 * is 1, without first streaming every page to find out. Applies the same
 * predicates as the stream and {@link countPageListRows}, so the answer is
 * about the rows actually being rendered, not about the archive's configured
 * roots (a root that yielded no listable page does not appear here).
 *
 * Pages whose URL could not be parsed at read-model build time have a `null`
 * `hostname` and are excluded by `COUNT(DISTINCT ...)`'s null handling — a
 * report cannot group them by host either, so the two agree.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current before calling this —
 *   it assumes `viewer_pages` exists and trusts its content.
 * @param options - Directory-prefix filters. Defaults to the whole site.
 * @returns The number of distinct hosts.
 * @throws {TypeError} If an `options.directories` entry is not a usable
 *   prefix (see `parsePageDirectoryPrefix`).
 * @example
 * const hosts = await countPageListHostnames(accessor);
 * const showHostColumn = hosts > 1;
 */
export async function countPageListHostnames(
	accessor: ArchiveAccessor,
	options: PageListRowFilterOptions = {},
): Promise<number> {
	const qb = accessor.getKnex()('viewer_pages');
	applyPageListRowFilters(qb, options);
	const rows = await qb.countDistinct<{ count: string | number }[]>({
		count: 'hostname',
	});
	return Number(rows[0]?.count ?? 0);
}
