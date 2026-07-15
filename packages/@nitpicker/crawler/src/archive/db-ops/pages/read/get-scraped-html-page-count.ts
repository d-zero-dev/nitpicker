import type { DB_Page } from '../../../types.js';
import type { Knex } from 'knex';

/**
 * Counts pages that were scraped as crawl targets (full HTML render).
 *
 * Used by the crawler to seed its `pagesScraped` counter on resume so the
 * progress display reflects all browser-rendered HTML pages across sessions,
 * not just the current one.
 *
 * "HTML page" is guaranteed by `contentType = 'text/html'`, NOT by `isTarget`
 * alone: `isTarget` means "in-scope crawl target" and is set for in-scope
 * non-HTML resources too (e.g. a PDF reached via the HEAD pre-flight is
 * `isTarget = 1`). Counting those would over-report the HTML page total, so
 * page-ness is asserted at the read layer here rather than by trusting
 * `isTarget`.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns The number of `text/html` rows with `isTarget = 1` and `scraped = 1`.
 */
export async function getScrapedHtmlPageCount(knex: Knex): Promise<number> {
	const [row] = await knex
		.from<DB_Page>('pages')
		.where('isTarget', 1)
		.andWhere('scraped', 1)
		.andWhere('contentType', 'text/html')
		.count<{ count: number }[]>('* as count');
	return row ? Number(row.count) : 0;
}
