import type { Knex } from 'knex';

import { createEntityTables } from './create-entity-tables.js';

/**
 * Adds the 0.13 entity / edge tables (issue #192) to archives created
 * before the 0.13 format.
 *
 * These are the 6 core normalised tables (`content_items`, `page_meta`,
 * `resource_items`, `anchor_edges`, `resource_ref_edges`, `image_items`) that
 * replace the legacy write model in the 0.13 format. Fresh archives get
 * them via `initSchema`; this migration is called only by
 * `scripts/migrate-to-0.13.mjs` as its schema catch-up step for pre-0.13
 * input archives. The archive-open path (`db-ops/lifecycle/init.ts`) does
 * not run it — `assertCompatibleVersion` guarantees every openable
 * archive already has the full table set.
 *
 * The migration is intentionally table-only. It does not back-fill any data
 * from `pages` / `resources` / `anchors` / `images` — that is the job of the
 * population steps (`populateRefTables` + `populateEntityTables`), which
 * read from the legacy tables and write
 * the entity rows in a single WAL transaction with `.bak` protection. This
 * migration only guarantees the empty tables exist so the populate step can
 * INSERT into them without hitting `SQLITE_ERROR: no such table:
 * content_items`.
 *
 * **Blocked-by contract**: `createEntityTables` references the
 * 0.13 ref tables (`url_refs`, `content_type_refs`, `text_refs`,
 * `json_refs`, `blob_refs`, `header_sets`) via `REFERENCES`. On an
 * existing archive, `migrateRefTables` MUST have run first so the
 * ref tables exist by the time this migration is applied.
 * `scripts/migrate-to-0.13.mjs` orders the two calls statically so this
 * ordering is enforced there, not here.
 *
 * **Idempotency**: `createEntityTables` itself uses
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
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migrateEntityTables(instance: Knex): Promise<void> {
	const hasContentItems = await instance.schema.hasTable('content_items');
	if (hasContentItems) {
		// Fast path: fully installed. `createEntityTables` would
		// still be a safe no-op, but re-running it just to be defensive
		// wastes 15 IF NOT EXISTS round-trips on every archive open.
		return;
	}
	await createEntityTables(instance);
	// eslint-disable-next-line no-console
	console.error('[migrate] 0.13 entity/edge tables created');
}
