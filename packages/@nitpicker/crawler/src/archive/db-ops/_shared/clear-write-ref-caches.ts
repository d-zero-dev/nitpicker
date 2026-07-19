import type { WriteRefCaches } from './types.js';

/**
 * Empties every map in a {@link WriteRefCaches} bundle in place.
 *
 * Called when a write transaction that used the caches rolls back. SQLite
 * `ROLLBACK` undoes every row the transaction inserted, but `AUTOINCREMENT`
 * counters never rewind — so an id cached optimistically during the failed
 * attempt would survive the rollback and no longer correspond to any row.
 * A retried attempt reusing that id would issue `UPDATE ... WHERE id = ?`
 * against a nonexistent row and silently affect zero rows instead of
 * failing loudly.
 *
 * A full clear (rather than tracking which entries the failed transaction
 * touched) is the simplest correct fix: transient write failures are rare
 * (retry exists precisely because they are), so paying a one-time
 * DB-again warm-up after a rollback is cheap next to the correctness risk
 * of a partially-poisoned cache.
 * @param caches - The cache bundle to clear.
 * @example
 * try {
 *   await knex.transaction(async (trx) => { ... });
 * } catch (error) {
 *   clearWriteRefCaches(caches);
 *   throw error;
 * }
 */
export function clearWriteRefCaches(caches: WriteRefCaches): void {
	caches.urlIds.clear();
	caches.contentItems.clear();
	caches.resourceIds.clear();
	caches.contentTypeIds.clear();
	caches.jsonIds.clear();
	caches.blobIds.clear();
	caches.headers = null;
}
