import type { Knex } from 'knex';

import { applyConnectionPragmas, initSchema } from '../../init-schema.js';
import { assertCompatibleVersion } from '../../meta/assert-compatible-version.js';
import { migrateContentItemsAliasOfId } from '../../migrate-content-items-alias-of-id.js';
import { migrateContentItemsDedupeCapEventId } from '../../migrate-content-items-dedupe-cap-event-id.js';
import { migrateInfoMainContentSelector } from '../../migrate-info-main-content-selector.js';
import { migrateInfoRoots } from '../../migrate-info-roots.js';
import { migrateInventoryRunsExcludeSkipped } from '../../migrate-inventory-runs-exclude-skipped.js';
import { migrateInventoryRunsInvalidSkipped } from '../../migrate-inventory-runs-invalid-skipped.js';
import { migrateMainContentsColumns } from '../../migrate-main-contents-columns.js';
import { migratePageMetaBodyHash } from '../../migrate-page-meta-body-hash.js';
import { migratePageMetaConsoleErrorCount } from '../../migrate-page-meta-console-error-count.js';
import { migratePageMetaCustomElementCount } from '../../migrate-page-meta-custom-element-count.js';
import { migratePageTagsToPageTechnologies } from '../../migrate-page-tags-to-page-technologies.js';
import { closeStaleOpenNetworkOutages } from '../outages/close-stale-open-network-outages.js';

/**
 * Initializes the database schema if tables do not exist, then runs the
 * remaining lightweight migrations (`info.roots`, `info.mainContentSelector`,
 * `page_meta.main_content_*`, `inventory_runs.invalid_skipped`,
 * `inventory_runs.exclude_skipped`).
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
 * `migratePageMetaConsoleErrorCount`, `migratePageMetaCustomElementCount`,
 * `migrateContentItemsAliasOfId`,
 *
 * `migratePageTagsToPageTechnologies` is the one exception to "column adds
 * only": it converts `page_tags` (removed) rows into `technology_signals`/
 * `page_technologies` and DROPS the old table — a one-time table-level ETL,
 * not a column add, but it belongs in this same boot phase for the same
 * reason (self-healing an old archive's schema before any reader runs).
 *
 * `migrateContentItemsDedupeCapEventId`, `migrateInventoryRunsInvalidSkipped`,
 * `migrateInventoryRunsExcludeSkipped`) rather than a DDL-string change alone.
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
	await migratePageMetaConsoleErrorCount(knex);
	await migratePageMetaCustomElementCount(knex);
	// Table-level migration (converts + drops page_tags), not a column
	// add — see its own JSDoc for why it still belongs in this boot phase.
	await migratePageTagsToPageTechnologies(knex);
	await migrateContentItemsAliasOfId(knex);
	// Runs after `initSchema` above, which already created
	// `dedupe_cap_events` (an adjunct table) unconditionally — so the new
	// column's `REFERENCES dedupe_cap_events(id)` target always exists by
	// this point, for both fresh and legacy archives.
	await migrateContentItemsDedupeCapEventId(knex);
	await migrateInventoryRunsInvalidSkipped(knex);
	await migrateInventoryRunsExcludeSkipped(knex);
	await closeStaleOpenNetworkOutages(knex);
}
