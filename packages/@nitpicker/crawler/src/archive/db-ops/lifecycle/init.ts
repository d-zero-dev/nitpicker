import type { Knex } from 'knex';

import { applyConnectionPragmas, initSchema } from '../../init-schema.js';
import { assertCompatibleVersion } from '../../meta/assert-compatible-version.js';
import { migrateAnalysisViolations } from '../../migrate-analysis-violations.js';
import { migrateCrawlErrors } from '../../migrate-crawl-errors.js';
import { migrateEntityTables } from '../../migrate-entity-tables.js';
import { migrateHtmlBlobTables } from '../../migrate-html-blob-tables.js';
import { migrateInfoRoots } from '../../migrate-info-roots.js';
import { migrateInventoryRuns } from '../../migrate-inventory-runs.js';
import { migratePageErrors } from '../../migrate-page-errors.js';
import { migratePagesResourcesSource } from '../../migrate-pages-resources-source.js';
import { migrateRefTables } from '../../migrate-ref-tables.js';

/**
 * Initializes the database schema if tables do not exist, then runs lightweight
 * migrations that bring older archives up to the current schema.
 *
 * Migrations are idempotent and run on every writer-side `Database.connect`;
 * in read-only mode they are SKIPPED so the same DB can be opened safely
 * by a viewer attached to a live (or interrupted) crawl without rewriting
 * the user's tmpDir.
 * @param knex - Knex query builder connected to the archive DB.
 * @param readOnly - When true, skip schema init + migrations.
 */
export async function init(knex: Knex, readOnly: boolean): Promise<void> {
	// Connection-level PRAGMAs (foreign_keys, mmap_size, …) must be
	// reapplied on every connect — they are not persisted across opens.
	// They are safe in read-only mode because they don't write to the
	// user's tmpDir, just configure the libsql connection.
	await applyConnectionPragmas(knex);
	// Reject pre-0.10 archives before any further work. Runs for both
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
	await migratePageErrors(knex);
	await migrateCrawlErrors(knex);
	await migrateHtmlBlobTables(knex);
	await migrateAnalysisViolations(knex);
	await migratePagesResourcesSource(knex);
	await migrateInventoryRuns(knex);
	await migrateRefTables(knex);
	// MUST run after migrateRefTables — 0.13 tables have
	// FK references to the 0.13 ref tables.
	await migrateEntityTables(knex);
}
