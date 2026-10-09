import type { Knex } from 'knex';

/**
 * Records a crawler-level (`error` channel) failure into `crawl_errors`.
 *
 * Unlike `insertPageError` this is not tied to a scraped page: `url`
 * may be an external link that never became a page row, or `null` for a
 * process-level error. The cause is intentionally not stored — it is derived
 * on read so that older archives (which only have `error.log`) and freshly
 * captured rows classify identically.
 * @param knex - Knex query builder connected to the archive DB.
 * @param url - The URL the error is about, or `null` for a process-level error.
 * @param message - The error message (one line is enough for classification).
 * @param isExternal - Whether the URL is external to the crawl scope.
 */
export async function insertCrawlError(
	knex: Knex,
	url: string | null,
	message: string,
	isExternal = false,
): Promise<void> {
	await knex('crawl_errors').insert({
		url,
		isExternal: isExternal ? 1 : 0,
		message,
		createdAt: Date.now(),
	});
}
