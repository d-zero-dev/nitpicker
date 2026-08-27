import type { PageListRowFilterOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyPageListRowFilters } from './apply-page-list-row-filters.js';

/**
 * Counts the pages `streamPageListRows` would yield, without materialising
 * any of them.
 *
 * Exact, not an estimate: both go through {@link applyPageListRowFilters}, so
 * a report can print "N pages" in a header, budget its output or decide it
 * has nothing to render at all, and be certain the number matches the rows
 * that follow. `countViewerPagesTotal` answers the unfiltered version of
 * this question for the Google Sheets Page List sheet; this one exists
 * because it also honours the directory-prefix filters, which live in the
 * report-export row-set definition rather than in `ListViewerPagesOptions`.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current before calling this —
 *   it assumes `viewer_pages` exists and trusts its content.
 * @param options - Directory-prefix filters. Defaults to the whole site.
 * @returns The number of matching pages.
 * @throws {TypeError} If an `options.directories` entry is not a usable
 *   prefix (see `parsePageDirectoryPrefix`).
 * @example
 * const total = await countPageListRows(accessor, { directories: ['/blog'] });
 */
export async function countPageListRows(
	accessor: ArchiveAccessor,
	options: PageListRowFilterOptions = {},
): Promise<number> {
	const qb = accessor.getKnex()('viewer_pages');
	applyPageListRowFilters(qb, options);
	const rows = await qb.count<{ count: string | number }[]>({ count: '*' });
	return Number(rows[0]?.count ?? 0);
}
