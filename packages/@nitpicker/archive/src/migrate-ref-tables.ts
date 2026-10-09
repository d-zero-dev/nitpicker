import type { Knex } from 'knex';

import { createRefTables } from './create-ref-tables.js';

/**
 * Adds the 0.13 dictionary tables (issue #190) to archives created before
 * the 0.13 format.
 *
 * These are the 10 ref / header dictionary tables that form the
 * durable write-model of the 0.13 format. Fresh archives get them via
 * `initSchema`; this migration is called only by
 * `scripts/migrate-to-0.13.mjs` as its schema catch-up step for pre-0.13
 * input archives. The archive-open path (`db-ops/lifecycle/init.ts`) does
 * not run it — `assertCompatibleVersion` guarantees every openable
 * archive already has the full table set.
 *
 * The migration is intentionally table-only. It does not back-fill any data
 * from `pages` / `resources` / `anchors` / `images` into the ref tables — that
 * is the job of the 0.13 population step, which reads from the legacy
 * tables and writes the ref rows in a single WAL transaction with `.bak`
 * protection. This migration only guarantees the empty tables exist so
 * consumers don't crash with `SQLITE_ERROR: no such table: url_refs`.
 *
 * Idempotent: presence of `url_refs` is used as the sentinel (all 10
 * tables are created together, so any one of them can serve as the sentinel).
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migrateRefTables(instance: Knex): Promise<void> {
	const hasUrlRefs = await instance.schema.hasTable('url_refs');
	if (hasUrlRefs) {
		return;
	}
	const hasPages = await instance.schema.hasTable('pages');
	if (!hasPages) {
		// Empty archive; the regular initSchema path will create the tables.
		return;
	}
	await createRefTables(instance);
	// eslint-disable-next-line no-console
	console.error('[migrate] 0.13 ref/header tables created');
}
