import type { Knex } from 'knex';

/**
 * Whether the current archive connection has the `page_templates` table.
 *
 * Archives crawled/analyzed before `--templates` DOM-structure
 * classification shipped don't have this table yet, and a viewer's
 * read-only connection to a live/interrupted crawl skips schema self-heal
 * entirely (see `@nitpicker/crawler`'s `db-ops/lifecycle/init.ts`). Every
 * page-list / page-detail query checks this once and conditionally joins
 * `page_templates` — a bare `LEFT JOIN page_templates` throws
 * `no such table: page_templates` on those connections regardless of
 * whether any row would have matched.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns Whether `page_templates` exists on this connection.
 * @example
 * const hasPageTemplates = await hasPageTemplatesTable(knex);
 * if (hasPageTemplates) {
 *   query.leftJoin('page_templates as pt', 'pt.page_id', 'ci.id');
 * }
 */
export async function hasPageTemplatesTable(knex: Knex): Promise<boolean> {
	return knex.schema.hasTable('page_templates');
}

/**
 * Builds the `templateKey` select expression, degrading to a `NULL` literal
 * when {@link hasPageTemplatesTable} is false so callers can always include
 * it in a column list without conditionally reshaping that list.
 * @param knex - Knex query builder connected to the archive DB.
 * @param hasPageTemplates - Result of {@link hasPageTemplatesTable} for this connection.
 * @returns A knex-select-compatible column expression aliased to `templateKey`.
 * @example
 * query.select(...PAGE_LIST_SELECT_COLUMNS, templateKeySelectColumn(knex, hasPageTemplates));
 */
export function templateKeySelectColumn(knex: Knex, hasPageTemplates: boolean) {
	return hasPageTemplates
		? 'pt.template_key as templateKey'
		: knex.raw('NULL as templateKey');
}
