import type { Knex } from 'knex';

import { createPhase6ARefTables } from './create-phase6a-ref-tables.js';

/**
 * Adds the Phase 6-A staging tables (issue #190) to archives created before
 * this branch shipped.
 *
 * These are the 10 ref / header dictionary tables that will become the
 * durable write-model under Phase 6-B/6-C/…. Fresh archives get them via
 * `initSchema`; this migration handles the "existing archive re-opened by
 * `crawl --append` / `--retry-failed` / analyze" path — the same pattern used
 * by `migrateCrawlErrors`, `migrateHtmlBlobTables`, etc.
 *
 * The migration is intentionally table-only. It does not back-fill any data
 * from `pages` / `resources` / `anchors` / `images` into the ref tables — that
 * is the job of the Phase 6-B population step, which reads from the legacy
 * tables and writes the ref rows in a single WAL transaction with `.bak`
 * protection. This migration only guarantees the empty tables exist so
 * consumers don't crash with `SQLITE_ERROR: no such table: url_refs`.
 *
 * Idempotent: presence of `url_refs` is used as the phase marker (all 10
 * tables are created together, so any one of them can serve as the sentinel).
 * On read-only connections the migration is skipped upstream, so this
 * function only ever runs against writer connections.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migratePhase6ARefTables(instance: Knex): Promise<void> {
	const hasUrlRefs = await instance.schema.hasTable('url_refs');
	if (hasUrlRefs) {
		return;
	}
	const hasPages = await instance.schema.hasTable('pages');
	if (!hasPages) {
		// Empty archive; the regular initSchema path will create the tables.
		return;
	}
	await createPhase6ARefTables(instance);
	// eslint-disable-next-line no-console
	console.error('[migrate] Phase 6-A ref/header tables created');
}
