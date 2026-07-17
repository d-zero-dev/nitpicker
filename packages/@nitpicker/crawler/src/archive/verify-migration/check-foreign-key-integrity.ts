import type { Knex } from 'knex';

import { MigrationVerificationError } from './types.js';

/**
 * Asserts that `PRAGMA foreign_key_check` reports zero violations across
 * the whole archive.
 *
 * Runs after `retargetLegacyFkTables` + `dropLegacyTables`, i.e. against
 * the final schema — every FK declaration at that point targets the
 * entity / ref tables, so a clean result proves the rebuilt adjunct
 * tables' rows all resolve against `content_items` and no dangling
 * reference survived the legacy-table removal. Running it earlier would
 * also scan the legacy tables (`anchors` alone can hold millions of
 * rows) for declarations that are about to be dropped anyway.
 *
 * `PRAGMA foreign_key_check` inspects data regardless of the
 * `foreign_keys` enforcement setting, so this check stays valid even
 * though the preceding drop phase runs with enforcement OFF.
 *
 * Not part of {@link verifyMigration}'s chain: that orchestrator runs
 * inside the entity-populate transaction while the legacy tables still
 * exist, a different point in the migration lifecycle than this
 * final-schema assertion.
 * @param trx - Knex instance or transaction on the migrated archive.
 * @throws {MigrationVerificationError} when any row violates an FK
 *   declaration; the context carries the violation count and the first
 *   offending child/parent table pair.
 * @example
 * await retargetLegacyFkTables(trx);
 * await dropLegacyTables(trx);
 * await checkForeignKeyIntegrity(trx); // throws unless zero violations
 */
export async function checkForeignKeyIntegrity(trx: Knex): Promise<void> {
	const rows: { table: string; rowid: number | null; parent: string }[] = await trx
		.select('*')
		.from(trx.raw('pragma_foreign_key_check'));
	if (rows.length === 0) {
		return;
	}
	throw new MigrationVerificationError({
		check: 'foreign_key_check',
		context: {
			violation_count: rows.length,
			first_offending_table: rows[0]?.table ?? '(unknown)',
			first_offending_parent: rows[0]?.parent ?? '(unknown)',
			first_offending_rowid: rows[0]?.rowid ?? null,
		},
	});
}
