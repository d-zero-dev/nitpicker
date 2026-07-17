import type { Knex } from 'knex';

/**
 * Drops the five legacy write-model tables from a migrated archive. Reader
 * and writer both operate exclusively on the entity / ref tables, so once
 * the 0.13 populate has copied everything across (and
 * `retargetLegacyFkTables` has repointed the adjunct FKs at
 * `content_items`), the legacy tables are pure dead weight — dropping them
 * reclaims the duplicated storage and removes the last consumers of the
 * `pages(id)` id-space.
 *
 * **Requires `PRAGMA foreign_keys = OFF`** (asserted at runtime, because a
 * caller that forgets the toggle would fail nondeterministically instead
 * of loudly). Two reasons for the requirement:
 *
 * 1. `pages.redirectDestId` is a self-referential FK. With enforcement ON,
 *    `DROP TABLE` performs an implicit `DELETE FROM`, and deleting a
 *    redirect-destination row before its source row trips the constraint —
 *    whether the drop survives depends on row order, so archives with
 *    redirect chains can fail nondeterministically.
 * 2. With enforcement OFF the implicit `DELETE FROM` is skipped entirely
 *    and SQLite reclaims each table as a whole b-tree — O(pages) row
 *    deletions become O(1) truncations, which matters at the several
 *    hundred-thousand-row scale real archives reach.
 *
 * The drops still run children-first (`resources-referrers` / `anchors` /
 * `images` reference `pages` / `resources`) as defence in depth. Missing
 * tables are skipped so the function is idempotent.
 *
 * Data-integrity of the surviving tables is asserted separately by
 * `checkForeignKeyIntegrity` (`PRAGMA foreign_key_check` ignores the
 * `foreign_keys` setting), which the migration script runs right after
 * this function.
 * @param trx - Knex transaction on the archive being migrated
 *   (`scripts/migrate-to-0.13.mjs` is the caller).
 * @throws {Error} when the connection still has `PRAGMA foreign_keys = ON`
 *   (`foreign_keys` cannot change inside a transaction, so the caller must
 *   toggle it off before opening the transaction).
 * @example
 * await db.raw('PRAGMA foreign_keys = OFF');
 * await db.transaction(async (trx) => {
 *   await dropLegacyTables(trx);
 * });
 * await db.raw('PRAGMA foreign_keys = ON');
 */
export async function dropLegacyTables(trx: Knex): Promise<void> {
	const pragma: { foreign_keys: number }[] = await trx.raw('PRAGMA foreign_keys');
	if (pragma[0]?.foreign_keys === 1) {
		throw new Error(
			'dropLegacyTables: PRAGMA foreign_keys is ON — turn it OFF before the transaction. ' +
				'With enforcement ON, dropping `pages` runs an implicit DELETE whose row order ' +
				'can trip the redirectDestId self-FK nondeterministically.',
		);
	}
	await trx.raw('DROP TABLE IF EXISTS "resources-referrers"');
	await trx.raw('DROP TABLE IF EXISTS "anchors"');
	await trx.raw('DROP TABLE IF EXISTS "images"');
	await trx.raw('DROP TABLE IF EXISTS "resources"');
	await trx.raw('DROP TABLE IF EXISTS "pages"');
}
