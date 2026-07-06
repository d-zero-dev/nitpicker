import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Counts the total number of duplicate groups for one metadata field — the
 * same `GROUP BY <field> HAVING COUNT(*) > 1` predicate `findDuplicates`
 * itself uses, wrapped in an outer `COUNT(*)` so the cost stays proportional
 * to the number of distinct duplicated values, not `pages`'s full row count.
 *
 * Exists solely for `getDuplicatesFastPath`'s legacy-fallback branch (issue
 * #115): unlike `findMismatches`, which already ran a real `COUNT(*)` on its
 * filtered query, `findDuplicates` never needed a total (it always returned
 * an unbounded, non-paginated array) — this gives the fallback branch an
 * accurate `total` instead of silently reporting the `limit`-truncated
 * result length.
 * @param accessor - The archive accessor to query.
 * @param field - The metadata field to check for duplicates.
 * @returns The total number of duplicate groups for `field`.
 * @example
 * const total = await countDuplicateGroups(accessor, 'title');
 * const page = await findDuplicates(accessor, 'title', 50, 0);
 * // `page` may be truncated to 50 entries; `total` is the true count.
 */
export async function countDuplicateGroups(
	accessor: ArchiveAccessor,
	field: 'title' | 'description' = 'title',
): Promise<number> {
	const knex = accessor.getKnex();
	const column = field === 'title' ? 'title' : 'description';

	const groups = knex('pages')
		.select(knex.raw('1'))
		.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
		.whereNull('redirectDestId')
		.whereNotNull(column)
		.whereNot(column, '')
		.groupBy(column)
		.having(knex.raw('count(*)'), '>', 1);

	const result = (await knex.count('* as total').from(groups.as('duplicateGroups'))) as {
		total: number | string;
	}[];
	return Number(result[0]?.total ?? 0);
}
