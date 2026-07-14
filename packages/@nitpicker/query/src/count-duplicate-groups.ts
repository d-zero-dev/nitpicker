import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Counts the total number of duplicate groups for one metadata field.
 *
 * Phase 6-F: reads through the Phase 6-C entity tables (`content_items`
 * joined to `content_type_refs` for the `text/html` filter and `page_meta`
 * for the deduped text-ref id). Groups on the narrow `text_refs.id`
 * integer key instead of the raw text column.
 * @param accessor - The archive accessor to query.
 * @param field - The metadata field to check for duplicates.
 * @returns The total number of duplicate groups for `field`.
 */
export async function countDuplicateGroups(
	accessor: ArchiveAccessor,
	field: 'title' | 'description' = 'title',
): Promise<number> {
	const knex = accessor.getKnex();
	const textIdColumn = field === 'title' ? 'pm.title_text_id' : 'pm.description_text_id';

	const groups = knex('content_items as ci')
		.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
		.join('page_meta as pm', 'pm.page_id', 'ci.id')
		.join('text_refs as tr', 'tr.id', textIdColumn)
		.select(knex.raw('1'))
		.where({ 'ci.scraped': 1, 'ci.is_external': 0, 'ctr.raw': 'text/html' })
		.whereNull('ci.redirect_dest_id')
		.whereNotNull(textIdColumn)
		.whereNot('tr.text', '')
		.groupBy(textIdColumn)
		.having(knex.raw('count(*)'), '>', 1);

	const result = (await knex.count('* as total').from(groups.as('duplicateGroups'))) as {
		total: number | string;
	}[];
	return Number(result[0]?.total ?? 0);
}
