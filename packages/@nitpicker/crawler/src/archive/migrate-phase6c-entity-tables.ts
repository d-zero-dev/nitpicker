import type { Knex } from 'knex';

import { createPhase6CEntityTables } from './create-phase6c-entity-tables.js';

/**
 * Adds the Phase 6-C entity / edge tables (issue #192) to archives created
 * before this branch shipped.
 *
 * These are the 6 core normalised tables (`content_items`, `page_meta`,
 * `resource_items`, `anchor_edges`, `resource_ref_edges`, `image_items`) that
 * will replace the legacy write model under Phase 6-F. Fresh archives get
 * them via `initSchema`; this migration handles the "existing archive
 * re-opened by `crawl --append` / `--retry-failed` / analyze" path — the same
 * pattern used by `migrateCrawlErrors`, `migratePhase6ARefTables`, etc.
 *
 * The migration is intentionally table-only. It does not back-fill any data
 * from `pages` / `resources` / `anchors` / `images` — that is the job of the
 * Phase 6-D populate step, which reads from the legacy tables and writes
 * the entity rows in a single WAL transaction with `.bak` protection. This
 * migration only guarantees the empty tables exist so Phase 6-D can
 * INSERT into them without hitting `SQLITE_ERROR: no such table:
 * content_items`.
 *
 * **Blocked-by contract**: `createPhase6CEntityTables` references the
 * Phase 6-A ref tables (`url_refs`, `content_type_refs`, `text_refs`,
 * `json_refs`, `blob_refs`, `header_sets`) via `REFERENCES`. On an
 * existing archive, `migratePhase6ARefTables` MUST have run first so the
 * ref tables exist by the time this migration is applied.
 * `Database.connect` orders the migrations statically so this ordering
 * is enforced there, not here.
 *
 * **Idempotency**: `createPhase6CEntityTables` itself uses
 * `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` for every
 * statement, so calling it multiple times against any DB state is safe.
 * That means this wrapper does not need a defensive sentinel — the
 * "content_items exists but page_meta was dropped externally" partial-
 * corruption case is fully repaired on next open because every CREATE
 * statement individually checks its own existence. The one thing the
 * wrapper adds beyond the primitive is a log line, which we still want
 * to emit only when creation actually happened, so we probe
 * `content_items` first and short-circuit when the schema is already
 * fully installed.
 *
 * On read-only connections the migration is skipped upstream, so this
 * function only ever runs against writer connections.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migratePhase6CEntityTables(instance: Knex): Promise<void> {
	const hasContentItems = await instance.schema.hasTable('content_items');
	if (hasContentItems) {
		// Fast path: fully installed. `createPhase6CEntityTables` would
		// still be a safe no-op, but re-running it just to be defensive
		// wastes 15 IF NOT EXISTS round-trips on every archive open.
		return;
	}
	await createPhase6CEntityTables(instance);
	// eslint-disable-next-line no-console
	console.error('[migrate] Phase 6-C entity/edge tables created');
}
