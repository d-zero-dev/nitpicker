import type { Knex } from 'knex';

import { applyConnectionPragmas, initSchema } from '../../init-schema.js';
import { assertCompatibleVersion } from '../../meta/assert-compatible-version.js';
import { migrateContentItemsAliasOfId } from '../../migrate-content-items-alias-of-id.js';
import { migrateInfoMainContentSelector } from '../../migrate-info-main-content-selector.js';
import { migrateInfoRoots } from '../../migrate-info-roots.js';
import { migrateMainContentsColumns } from '../../migrate-main-contents-columns.js';
import { migratePageMetaBodyHash } from '../../migrate-page-meta-body-hash.js';
import { closeStaleOpenNetworkOutages } from '../outages/close-stale-open-network-outages.js';

/**
 * Initializes the database schema if tables do not exist, then runs the
 * remaining lightweight migrations (`info.roots`, `info.mainContentSelector`,
 * `page_meta.main_content_*`).
 *
 * There is deliberately no per-table *table-creation* migration chain here:
 * `assertCompatibleVersion` (called below, before any schema work) rejects
 * every archive older than the current format, so a connection that reaches
 * `initSchema` is either brand new (`initSchema` provisions the full schema)
 * or was produced by `scripts/migrate-to-0.13.mjs` (which guarantees the
 * full table set before it repacks) — and `initSchema` itself re-runs
 * `createEntityTables` / `createAdjunctTables` unconditionally on every
 * open, self-healing any *missing table* via their internal
 * `IF NOT EXISTS` / `hasTable` guards. What that self-healing cannot do is
 * retrofit a *new column* onto an entity table that already exists —
 * `CREATE TABLE IF NOT EXISTS` is a no-op once the table is present. Column
 * additions to an existing 0.13 table are therefore the one case that still
 * needs an explicit `hasColumn`-guarded `ALTER TABLE` here (`migrateInfoRoots`,
 * `migrateMainContentsColumns`, `migratePageMetaBodyHash`,
 * `migrateContentItemsAliasOfId`) rather than a DDL-string change alone.
 *
 * `closeStaleOpenNetworkOutages` is not a schema migration (no columns
 * change) but belongs at this same boot phase for the same reason the
 * others do: it must run before ANY reader (`resetFailedPages`,
 * `listDnsBurnedHostCandidates`, …) can observe a `network_outages` row
 * left `ended_at = NULL` by a crawl process that was killed mid-outage in a
 * prior session.
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
	await migrateInfoMainContentSelector(knex);
	await migrateMainContentsColumns(knex);
	await migratePageMetaBodyHash(knex);
	await migrateContentItemsAliasOfId(knex);
	await closeStaleOpenNetworkOutages(knex);
}
