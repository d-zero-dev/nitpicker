import type { Knex } from 'knex';

/**
 * Builds the two `templateLabelSection` / `templateLabelOrdinal` select
 * expressions off the `page_template_labels as ptl` join, degrading to
 * `NULL` literals when the join is not in place so callers can always
 * spread them into a column list — the same shape as
 * {@link import('./page-templates-join.js').templateKeySelectColumn}.
 *
 * The join itself is the caller's: `LEFT JOIN page_template_labels as ptl
 * ON ptl.template_key = pt.template_key`, only when both
 * {@link import('./page-templates-join.js').hasPageTemplatesTable} and
 * {@link import('./has-page-template-labels-table.js').hasPageTemplateLabelsTable}
 * hold (the label join hangs off the `pt` alias).
 * @param knex - Knex query builder connected to the archive DB.
 * @param hasLabelsJoin - Whether the `ptl` join is present on the query.
 * @returns Two knex-select-compatible column expressions.
 * @example
 * query.select(...PAGE_LIST_SELECT_COLUMNS, ...templateLabelSelectColumns(knex, hasLabelsJoin));
 */
export function templateLabelSelectColumns(knex: Knex, hasLabelsJoin: boolean) {
	return hasLabelsJoin
		? ['ptl.section as templateLabelSection', 'ptl.ordinal as templateLabelOrdinal']
		: [
				knex.raw('NULL as templateLabelSection'),
				knex.raw('NULL as templateLabelOrdinal'),
			];
}
