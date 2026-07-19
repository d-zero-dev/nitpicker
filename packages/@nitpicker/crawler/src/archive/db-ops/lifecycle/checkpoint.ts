import type { Knex } from 'knex';

/**
 * Forces a WAL checkpoint, writing all pending WAL data back to the main database file.
 * Uses TRUNCATE mode to reset the WAL file to zero bytes after checkpointing.
 * This ensures the database is fully self-contained in `db.sqlite` before archiving.
 * @param knex - Knex query builder connected to the archive DB.
 */
export async function checkpoint(knex: Knex): Promise<void> {
	await knex.raw('PRAGMA wal_checkpoint(TRUNCATE)');
}
