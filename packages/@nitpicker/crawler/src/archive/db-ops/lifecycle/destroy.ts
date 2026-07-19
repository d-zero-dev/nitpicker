import type { Knex } from 'knex';

/**
 * Destroys the database connection, releasing all pooled resources.
 * @param knex - Knex query builder connected to the archive DB.
 */
export async function destroy(knex: Knex): Promise<void> {
	await knex.destroy();
}
