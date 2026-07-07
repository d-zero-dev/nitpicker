import type { DuplicateEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * ASCII Unit Separator — used as the GROUP_CONCAT delimiter so the URL
 * split is unambiguous even when an URL contains commas, pipes, or any
 * other commonly-used delimiter. `\x1F` is illegal in URLs per RFC 3986,
 * so there is no realistic conflict.
 */
const URL_DELIMITER = '';

/**
 * Finds pages with duplicate title or description metadata.
 *
 * Uses a single SQL pass — `GROUP BY <field> HAVING COUNT(*) > 1` with
 * `GROUP_CONCAT(url, X'1F')` to materialise the URL list for each group
 * inside the same query. The previous implementation issued one
 * `SELECT url` follow-up per duplicate group (a textbook N+1: 1 + N
 * queries for N groups), which was ~413s on a 168k-HTML-page archive
 * because each follow-up triggered another full-table scan. The
 * GROUP_CONCAT rewrite runs in ~8s on the same archive (49.6x speedup,
 * confirmed by `scripts/bench-find-duplicates.mjs`). The dominant cost is
 * now the single GROUP BY scan; further wins require either ANALYZE
 * (forbidden — see `idx_pages_listfilter` JSDoc) or schema denormalisation,
 * both out of scope.
 *
 * The URL delimiter is ASCII Unit Separator (`\x1F`), which is illegal in
 * URLs per RFC 3986. This keeps the JS split unambiguous without escaping.
 * @param accessor - The archive accessor to query.
 * @param field - The metadata field to check for duplicates.
 * @param limit - Maximum number of duplicate groups to return. Defaults to 50.
 * @param offset - Number of duplicate groups (in `ORDER BY cnt DESC` order)
 *   to skip before `limit` is applied. Defaults to 0 — added alongside
 *   `getDuplicatesFastPath`'s legacy-fallback branch (issue #115) so a
 *   caller can page through every duplicate group on an archive whose
 *   viewer read model isn't current yet, mirroring `findMismatches`'s own
 *   `offset` support.
 * @returns An array of duplicate entries with the shared value and matching URLs.
 * @example
 * // Second page of 50 duplicate title-groups, most-duplicated first:
 * const page2 = await findDuplicates(accessor, 'title', 50, 50);
 */
export async function findDuplicates(
	accessor: ArchiveAccessor,
	field: 'title' | 'description' = 'title',
	limit: number = 50,
	offset: number = 0,
): Promise<DuplicateEntry[]> {
	const knex = accessor.getKnex();
	// `field` is constrained to the literal union 'title' | 'description', so
	// no string-injection risk from interpolating it into the GROUP BY clause.
	const column = field === 'title' ? 'title' : 'description';

	const rows = (await knex('pages')
		.select(
			knex.raw(`?? as value`, [column]),
			knex.raw(`count(*) as cnt`),
			knex.raw(`group_concat(url, ?) as urls`, [URL_DELIMITER]),
		)
		.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
		.whereNull('redirectDestId')
		.whereNotNull(column)
		.whereNot(column, '')
		.groupBy(column)
		.having('cnt', '>', 1)
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
