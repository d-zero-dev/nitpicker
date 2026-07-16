import type { Knex } from 'knex';

/**
 * Counts pages that were scraped as crawl targets (full HTML render).
 *
 * Used by the crawler to seed its `pagesScraped` counter on resume so the
 * progress display reflects all browser-rendered HTML pages across sessions,
 * not just the current one.
 *
 * "HTML page" is guaranteed by `content_type_refs.raw = 'text/html'`, NOT by
 * `is_target` alone: `is_target` means "in-scope crawl target" and is set
 * for in-scope non-HTML resources too (e.g. a PDF reached via the HEAD
 * pre-flight is `is_target = 1`). Counting those would over-report the HTML
 * page total, so page-ness is asserted at the read layer here rather than by
 * trusting `is_target`.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns The number of `text/html` rows with `is_target = 1` and `scraped = 1`.
 */
export async function getScrapedHtmlPageCount(knex: Knex): Promise<number> {
	const [row] = await knex('content_items')
		.join('content_type_refs', 'content_type_refs.id', 'content_items.content_type_id')
		.where('content_items.is_target', 1)
		.andWhere('content_items.scraped', 1)
		.andWhere('content_type_refs.raw', 'text/html')
		.count<{ count: number }[]>('* as count');
	return row ? Number(row.count) : 0;
}
