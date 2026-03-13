import type {
	LinkAnalysisResult,
	LinkEntry,
	ListLinksOptions,
	OrphanedPageEntry,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Analyzes links in the archive: broken links, external links, or orphaned pages.
 * Uses SQL-level JOINs and filtering for performance with large link datasets.
 * @param accessor - The archive accessor to query.
 * @param options - Filter and pagination options.
 * @returns Link analysis results with entries and total count, or orphaned page list.
 */
export async function listLinks(
	accessor: ArchiveAccessor,
	options: ListLinksOptions,
): Promise<LinkAnalysisResult | { items: OrphanedPageEntry[]; total: number }> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	if (options.type === 'orphaned') {
		return listOrphanedPages(accessor, limit, offset);
	}

	const baseQuery = knex('anchors')
		.select(
			'source.url as sourceUrl',
			'dest.url as destUrl',
			'dest.status',
			'dest.isExternal',
			'anchors.textContent',
		)
		.join('pages as source', 'anchors.pageId', '=', 'source.id')
		.join('pages as dest', 'anchors.hrefId', '=', 'dest.id');

	if (options.type === 'broken') {
		baseQuery.where((qb) => {
			qb.where('dest.status', '>=', 400).orWhereNull('dest.status');
		});
	} else if (options.type === 'external') {
		baseQuery.where('dest.isExternal', 1);
	}

	const countResult = (await baseQuery
		.clone()
		.clearSelect()
		.count('anchors.id as total')) as { total: number }[];
	// SQL count() always returns exactly one row
	const total = countResult[0]?.total ?? 0;

	const rows = await baseQuery.clone().limit(limit).offset(offset);

	const items: LinkEntry[] = rows.map(
		(row: {
			sourceUrl: string;
			destUrl: string;
			status: number | null;
			isExternal: 0 | 1;
			textContent: string | null;
		}) => ({
			sourceUrl: row.sourceUrl,
			destUrl: row.destUrl,
			status: row.status,
			isExternal: !!row.isExternal,
			textContent: row.textContent,
		}),
	);

	return {
		items,
		total: Number(total),
	};
}

/**
 * Finds pages with no incoming links (orphaned pages).
 * @param accessor - The archive accessor to query.
 * @param limit - Maximum number of results.
 * @param offset - Number of results to skip.
 * @returns List of orphaned pages.
 */
async function listOrphanedPages(
	accessor: ArchiveAccessor,
	limit: number,
	offset: number,
): Promise<{ items: OrphanedPageEntry[]; total: number }> {
	const knex = accessor.getKnex();

	const countResult = (await knex('pages')
		.count('pages.id as total')
		.leftJoin('anchors', 'pages.id', '=', 'anchors.hrefId')
		.whereNull('anchors.id')
		.where({
			'pages.scraped': 1,
			'pages.isExternal': 0,
			'pages.contentType': 'text/html',
		})
		.whereNull('pages.redirectDestId')) as { total: number }[];

	// SQL count() always returns exactly one row
	const total = countResult[0]?.total ?? 0;

	const rows = await knex('pages')
		.select('pages.url', 'pages.status', 'pages.title')
		.leftJoin('anchors', 'pages.id', '=', 'anchors.hrefId')
		.whereNull('anchors.id')
		.where({
			'pages.scraped': 1,
			'pages.isExternal': 0,
			'pages.contentType': 'text/html',
		})
		.whereNull('pages.redirectDestId')
		.limit(limit)
		.offset(offset);

	const items: OrphanedPageEntry[] = rows.map(
		(row: { url: string; status: number | null; title: string | null }) => ({
			url: row.url,
			title: row.title,
			status: row.status,
		}),
	);

	return {
		items,
		total: Number(total),
	};
}
