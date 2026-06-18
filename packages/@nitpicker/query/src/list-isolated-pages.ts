import type { IsolatedPageEntry, ListIsolatedPagesOptions, PageSource } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

/**
 * List internal HTML pages that no other page links to — "orphan" pages
 * not reachable from the recursive crawl graph.
 *
 * Isolation is judged purely by the link graph: `anchors.hrefId IS NULL`
 * means no page anchors point at this row. The `pages.source` value is
 * IGNORED in the WHERE clause and returned only as a per-row badge, so
 * orphans first discovered by `crawl --inventory` and orphans discovered
 * by the original crawl both surface here equally.
 *
 * Archived roots (`info.roots`) are excluded — those are seeds by
 * definition and would otherwise dominate the result set. Only HTML
 * pages count: PDFs / images / non-HTML rows are out of scope (consumers
 * who care about unused non-HTML assets use
 * {@link import('./list-unused-resources.js').listUnusedResources}
 * instead).
 *
 * Read-only — safe against viewer / stub-mode archives.
 * @param accessor - The archive accessor to query.
 * @param options - Pagination options.
 * @returns Paginated list of isolated pages with their `source` badge.
 */
export async function listIsolatedPages(
	accessor: ArchiveAccessor,
	options: ListIsolatedPagesOptions = {},
): Promise<{ items: IsolatedPageEntry[]; total: number }> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	// Pull archived roots so they can be excluded — they are seeds by
	// definition and would otherwise drown out real orphans.
	const infoRow = (await knex('info').select('roots').first()) as
		| { roots: string | null }
		| undefined;
	const roots: string[] = infoRow?.roots ? (JSON.parse(infoRow.roots) as string[]) : [];

	const baseWhere = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
		const filtered = qb
			.leftJoin('anchors', 'pages.id', '=', 'anchors.hrefId')
			.whereNull('anchors.id')
			.where({
				'pages.scraped': 1,
				'pages.isExternal': 0,
				'pages.contentType': 'text/html',
			})
			.whereNull('pages.redirectDestId');
		return roots.length > 0 ? filtered.whereNotIn('pages.url', roots) : filtered;
	};

	const countResult = (await baseWhere(knex('pages')).count('pages.id as total')) as {
		total: number;
	}[];
	const total = countResult[0]?.total ?? 0;

	const rows = (await baseWhere(knex('pages'))
		.select('pages.url', 'pages.status', 'pages.title', 'pages.source')
		.orderBy('pages.url')
		.limit(limit)
		.offset(offset)) as {
		url: string;
		status: number | null;
		title: string | null;
		source: string | null;
	}[];

	const items: IsolatedPageEntry[] = rows.map((row) => ({
		url: row.url,
		title: row.title,
		status: row.status,
		// Tolerate pre-migration archives where the column is absent —
		// `?? 'crawled'` mirrors the DB DEFAULT.
		source: (row.source ?? 'crawled') as PageSource,
	}));

	return {
		items,
		total: Number(total),
	};
}
