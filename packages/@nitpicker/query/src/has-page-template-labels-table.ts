import type { Knex } from 'knex';

/**
 * Whether the current archive connection has the `page_template_labels`
 * table.
 *
 * Archives last written before template labels shipped don't have this
 * table yet, and a viewer's read-only connection to a live/interrupted
 * crawl skips schema self-heal entirely (see `@nitpicker/archive`'s
 * `db-ops/lifecycle/init.ts`) — same rationale as
 * {@link import('./page-templates-join.js').hasPageTemplatesTable}.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns Whether `page_template_labels` exists on this connection.
 * @example
 * const hasLabels = await hasPageTemplateLabelsTable(knex);
 */
export async function hasPageTemplateLabelsTable(knex: Knex): Promise<boolean> {
	return knex.schema.hasTable('page_template_labels');
}
