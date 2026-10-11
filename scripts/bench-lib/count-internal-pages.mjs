/**
 * Counts the archive's crawled internal HTML pages — the "page count" every
 * baseline records to describe its input size: `content_items` rows that are
 * internal, scraped, not redirect sources and served as `text/html`. Rows
 * that are only URLs (discovered but not fetched, redirect sources,
 * internal PDFs) are left out, so the count tracks the pages the measured
 * operations actually process.
 * @param {import('knex').Knex} knex - The archive's connection.
 * @returns {Promise<number>} The number of such pages.
 * @example
 * const pageCount = await countInternalPages(accessor.getKnex());
 */
export async function countInternalPages(knex) {
	const [row] = await knex('content_items as ci')
		.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
		.where({ 'ci.is_external': 0, 'ci.scraped': 1, 'ctr.raw': 'text/html' })
		.whereNull('ci.redirect_dest_id')
		.count({ count: '*' });
	return Number(row.count);
}
