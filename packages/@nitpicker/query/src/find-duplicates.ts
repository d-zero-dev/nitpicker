import type { DuplicateEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * ASCII Unit Separator — used as the GROUP_CONCAT delimiter so the URL
 * split is unambiguous even when an URL contains commas, pipes, or any
 * other commonly-used delimiter. `\x1F` is illegal in URLs per RFC 3986,
 * so there is no realistic conflict.
 */
const URL_DELIMITER = '';

/**
 * Finds pages with duplicate title or description metadata.
 *
 * 0.13: reads through the 0.13 entity tables (`content_items`
 * joined to `page_meta` for the field's `text_ref` and `url_refs` for the
 * page URL) and groups on the deduped `text_refs.id` — walking a narrow
 * integer key instead of the raw text column. `GROUP_CONCAT(url, X'1F')`
 * still materialises the URL list for each group inside the same query,
 * preserving the single-pass optimisation (~50× faster than the pre-6
 * N+1 implementation).
 *
 * The URL delimiter is ASCII Unit Separator (`\x1F`), which is illegal in
 * URLs per RFC 3986. This keeps the JS split unambiguous without escaping.
 * @param accessor - The archive accessor to query.
 * @param field - The metadata field to check for duplicates.
 * @param limit - Maximum number of duplicate groups to return. Defaults to 50.
 * @param offset - Number of duplicate groups (in `ORDER BY cnt DESC` order)
 *   to skip before `limit` is applied. Defaults to 0.
 * @returns An array of duplicate entries with the shared value and matching URLs.
 */
export async function findDuplicates(
	accessor: ArchiveAccessor,
	field: 'title' | 'description' = 'title',
	limit: number = 50,
	offset: number = 0,
): Promise<DuplicateEntry[]> {
	const knex = accessor.getKnex();
	// `field` is constrained to the literal union so no string-injection
	// risk from interpolating the column name into the SQL.
	const textIdColumn = field === 'title' ? 'pm.title_text_id' : 'pm.description_text_id';

	const rows = (await knex('content_items as ci')
		.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
		.join('page_meta as pm', 'pm.page_id', 'ci.id')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.join('text_refs as tr', 'tr.id', textIdColumn)
		.select(
			knex.raw('"tr"."text" as value'),
			knex.raw('count(*) as cnt'),
			knex.raw('group_concat("ur"."url", ?) as urls', [URL_DELIMITER]),
		)
		.where({ 'ci.scraped': 1, 'ci.is_external': 0, 'ctr.raw': 'text/html' })
		.whereNull('ci.redirect_dest_id')
		.whereNotNull(textIdColumn)
		.whereNot('tr.text', '')
		.groupBy(textIdColumn)
		.having(knex.raw('count(*) > 1'))
		.orderBy('cnt', 'desc')
		.limit(limit)
		.offset(offset)) as { value: string; cnt: number; urls: string }[];

	return rows.map((row) => ({
		field,
		value: row.value,
		urls: row.urls.split(URL_DELIMITER),
		count: Number(row.cnt),
	}));
}
