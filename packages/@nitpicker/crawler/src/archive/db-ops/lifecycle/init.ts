import type { Knex } from 'knex';

import { applyConnectionPragmas, initSchema } from '../../init-schema.js';
import { assertCompatibleVersion } from '../../meta/assert-compatible-version.js';
import { migrateInfoRoots } from '../../migrate-info-roots.js';

/**
 * Initializes the database schema if tables do not exist, then runs the
 * one remaining lightweight migration (`info.roots`).
 *
 * There is deliberately no per-table lazy-migration chain here:
 * `assertCompatibleVersion` (called below, before any schema work)
 * rejects every archive older than the current format, so a connection
 * that reaches `initSchema` is either brand new (initSchema provisions
 * the full schema) or was produced by `scripts/migrate-to-0.13.mjs`
 * (which guarantees the full table set before it repacks). A
 * `hasTable`-guarded catch-up migration could therefore never fire —
 * schema catch-up for old archives is the migration script's job, not
 * the open path's.
 *
 * In read-only mode schema init + migration are SKIPPED so the same DB
 * can be opened safely by a viewer attached to a live (or interrupted)
 * crawl without rewriting the user's tmpDir.
 * @param knex - Knex query builder connected to the archive DB.
 * @param readOnly - When true, skip schema init + migrations.
 */
export async function init(knex: Knex, readOnly: boolean): Promise<void> {
	// Connection-level PRAGMAs (foreign_keys, mmap_size, …) must be
	// reapplied on every connect — they are not persisted across opens.
	// They are safe in read-only mode because they don't write to the
	// user's tmpDir, just configure the libsql connection.
	await applyConnectionPragmas(knex);
	// Reject incompatible archives before any further work. Runs for both
	// writer and read-only (stub viewer) connections so old
	// `._nitpicker-*` stubs surface a clear error instead of
	// dereferencing missing columns at query time. New archives (no
	// `info` table yet) pass through; the schema is filled in by
	// `initSchema` below.
	await assertCompatibleVersion(knex);
	if (readOnly) {
		return;
	}
	await initSchema(knex);
	await migrateInfoRoots(knex);
}
