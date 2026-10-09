import type { Knex } from 'knex';

import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

/**
 * Attaches a source archive's `db.sqlite` file to the destination
 * connection under the {@link TRANSFER_SOURCE_ALIAS} schema alias, so a
 * transfer can read the source and write the destination in the same SQL
 * statement (`INSERT INTO main.content_items SELECT ... FROM xfer_src.content_items`).
 *
 * `ATTACH DATABASE` must run OUTSIDE any transaction — SQLite rejects it
 * with "cannot ATTACH database within transaction" otherwise — so this is
 * always called before `knex.transaction(...)` opens, never inside it. The
 * returned function detaches and must be called after the transaction
 * commits or rolls back, in a `finally`.
 * @param knex - Knex query builder connected to the destination archive DB
 *   (the connection whose schema this attaches to — not a transaction).
 * @param sourceDbPath - Absolute path to the source's `db.sqlite` file
 *   (typically `path.join(accessor.tmpDir, Archive.SQLITE_DB_FILE_NAME)`).
 * @returns An async function that detaches the source. Idempotent-safe to
 *   call even if the attach itself failed partway (best-effort).
 * @throws {Error} If `ATTACH DATABASE` fails (e.g. the path does not exist,
 *   or a transaction is already open on this connection).
 * @example
 * ```ts
 * const detach = await attachSourceDatabase(knex, sourceDbPath);
 * try {
 *   await knex.transaction(async (trx) => { ... trx.raw('SELECT * FROM xfer_src.content_items') ... });
 * } finally {
 *   await detach();
 * }
 * ```
 */
export async function attachSourceDatabase(
	knex: Knex,
	sourceDbPath: string,
): Promise<() => Promise<void>> {
	await knex.raw('ATTACH DATABASE ? AS ' + TRANSFER_SOURCE_ALIAS, [sourceDbPath]);
	const attached: { name: string }[] = await knex.raw('PRAGMA database_list');
	if (!attached.some((row) => row.name === TRANSFER_SOURCE_ALIAS)) {
		throw new Error(
			`Failed to attach source database at ${sourceDbPath} — PRAGMA database_list does not list "${TRANSFER_SOURCE_ALIAS}" after ATTACH.`,
		);
	}
	return async () => {
		await knex.raw('DETACH DATABASE ' + TRANSFER_SOURCE_ALIAS).catch(() => {});
	};
}
