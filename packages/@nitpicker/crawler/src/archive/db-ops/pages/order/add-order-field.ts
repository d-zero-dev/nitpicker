import type { Knex } from 'knex';

/**
 * Adds the `order` column to the `pages` table for URL sort ordering.
 * If the column already exists, this function does nothing.
 * @deprecated Since v0.1.x. The column is now created during table initialization.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns The result of the schema alteration, or void if the column already exists.
 */
export async function addOrderField(knex: Knex) {
	const hasColumn = await knex.schema.hasColumn('pages', 'order');
	if (hasColumn) {
		return;
	}
	return await knex.schema.table('pages', (t) => {
		t.integer('order').unsigned().nullable().defaultTo(null);
	});
}
