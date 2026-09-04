import type { Knex } from 'knex';

import { createAdjunctTables } from './create-adjunct-tables.js';
import { createEntityTables } from './create-entity-tables.js';
import { createRefTables } from './create-ref-tables.js';

/**
 * Applies the connection-level PRAGMAs that govern foreign-key enforcement
 * and BLOB-read performance. These are **per-connection** settings (libsql
 * resets them when a new connection is opened), so they must be reapplied
 * every time `Database.connect` runs — not just on first-time schema
 * initialization. Keeping them separate from `initSchema`'s one-shot path
 * also lets `page_size` (which only takes effect against an empty DB)
 * stay gated behind the existence check.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function applyConnectionPragmas(instance: Knex): Promise<void> {
	// Foreign-key enforcement defaults to OFF on every new SQLite
	// connection. Required for ON DELETE CASCADE on `page_html_ref`,
	// `technology_signals`, `page_technologies`, `page_jsonld`, and the
	// `page_main_content_*` tables to fire.
	await instance.raw('PRAGMA foreign_keys = ON');
	await instance.raw('PRAGMA wal_autocheckpoint = 1000');
	// Negative value = KiB of memory (64 MiB). Helps large BLOB scans.
	//
	// Empirically validated against larger values on a 10 GB archive:
	// bumping to 512 MiB regressed `getSummary` (1.9s → 5.7s), `pages`
	// (2.3s → 21s), and `images` (3.7s → 12s) — libsql's page eviction
	// policy interacts poorly with a cache sized comparable to the
	// host's page-cache window when the DB itself far exceeds RAM.
	// 64 MiB stays the sweet spot.
	await instance.raw('PRAGMA cache_size = -65536');
	// 256 MiB mmap window. SQLite falls back to read() past this so the
	// limit is a soft ceiling, not a hard one. A 4 GiB window was
	// catastrophic on a 10 GB archive on macOS (summary 1.9s → 43s,
	// pages 2.3s → 21s) — the kernel's read-ahead policy and libsql's
	// mmap path interact badly when the window can cover most of the
	// DB. Keep this conservative.
	await instance.raw('PRAGMA mmap_size = 268435456');
}

/**
 * Initializes the archive database schema if tables do not exist.
 *
 * The schema is composed of four groups, each owned by a dedicated DDL
 * function so the migration script (`scripts/migrate-to-0.13.mjs`) can
 * provision the exact same shapes on archives it upgrades:
 *
 * - **`info`** (inline below): single-row crawl configuration.
 * - **Ref / header dictionary tables** ({@link createRefTables}):
 *   `url_refs`, `content_type_refs`, `text_refs`, `json_refs`,
 *   `blob_refs`, `header_name_refs`, `header_value_refs`, `header_sets`,
 *   `header_set_entries`, `header_flags`. See that file for column-level
 *   rationale and the reason `blob_refs` uses a regular rowid PK instead
 *   of WITHOUT ROWID.
 * - **Entity / edge tables** ({@link createEntityTables}):
 *   `content_items`, `page_meta`, `resource_items`, `anchor_edges`,
 *   `resource_ref_edges`, `image_items` — the write-model the crawler
 *   writes during a crawl and every reader queries. Must run AFTER
 *   `createRefTables` because most entity tables reference ref-table PKs.
 * - **Adjunct tables** ({@link createAdjunctTables}): `page_errors`,
 *   `crawl_errors`, `technology_signals`, `page_technologies`, `page_jsonld`, `inventory_runs`,
 *   `analysis_text_refs` + `analysis_violations`, `page_html_blobs` +
 *   `page_html_ref`. Must run AFTER `createEntityTables` because the
 *   page-scoped tables FK into `content_items(id)`.
 *
 * The legacy flat write-model tables (`pages` / `anchors` / `images` /
 * `resources` / `resources-referrers`) are deliberately NOT created:
 * they only exist inside pre-0.13 archives, where they serve as the
 * populate source for `scripts/migrate-to-0.13.mjs` before that script
 * drops them.
 *
 * **PRAGMA `page_size` and `journal_mode`** are set BEFORE any
 * `CREATE TABLE` because SQLite only honors `page_size` changes against
 * an empty database, and `journal_mode = WAL` is persistent. Other
 * per-connection PRAGMAs live in {@link applyConnectionPragmas}.
 *
 * Pre-0.13 migration is intentionally absent. `assertCompatibleVersion`
 * (called before `initSchema`) rejects older archives with a friendly
 * error naming the migration scripts to run; `v0.x` policy allows
 * breaking changes.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function initSchema(instance: Knex) {
	// Only the one-shot work (PRAGMAs + `info` creation) is gated on the
	// `info` table's existence. The three DDL groups below run on EVERY
	// call: each is internally idempotent (sentinel / IF NOT EXISTS /
	// per-table guards), and re-running them self-heals an archive whose
	// provisioning crashed partway through — `info` created but a later
	// group missing. With a single all-or-nothing gate, such a stub would
	// short-circuit here forever and every subsequent write would die with
	// `no such table` and no way back.
	if (!(await instance.schema.hasTable('info'))) {
		// Page size must be set on an empty database file; once any data is
		// written, only VACUUM can change it. journal_mode is also one-shot
		// (persistent) and so stays here.
		await instance.raw('PRAGMA page_size = 16384');
		await instance.raw('PRAGMA journal_mode = WAL');

		await instance.schema.createTable('info', (t) => {
			t.increments('id');
			t.string('version');
			t.string('name');
			t.string('baseUrl');
			t.json('roots');
			t.boolean('recursive');
			t.integer('interval');
			t.boolean('image');
			t.boolean('fetchExternal');
			t.integer('parallels');
			t.json('excludes');
			t.json('excludeKeywords');
			t.json('excludeUrls');
			t.integer('maxExcludedDepth');
			t.integer('retry');
			t.boolean('fromList');
			t.boolean('disableQueries');
			t.string('userAgent');
			t.boolean('ignoreRobots');
			t.string('mainContentSelector');
			t.string('createdCwd');
		});
	}

	// 0.13 ref / header dictionary tables. DDL + column-level rationale
	// lives in {@link createRefTables}, shared with the migration script's
	// schema catch-up — a divergence between the two paths would silently
	// break the population step's UNIQUE / CHECK contract.
	// `createRefTables` uses bare CREATE TABLE, so it needs a sentinel
	// guard here (all 10 tables are created together — any one of them
	// works as the sentinel).
	if (!(await instance.schema.hasTable('url_refs'))) {
		await createRefTables(instance);
	}

	// 0.13 core entity / edge tables — the write-model the crawler writes
	// during a crawl and every reader queries. MUST run after
	// {@link createRefTables} because `content_items`, `page_meta`,
	// `resource_items`, `anchor_edges`, and `image_items` all reference
	// the ref tables (`url_refs`, `content_type_refs`, `text_refs`,
	// `json_refs`, `blob_refs`, `header_sets`) via FK clauses.
	await createEntityTables(instance);

	// Adjunct tables that FK into `content_items` (page_errors /
	// technology_signals / page_technologies / page_jsonld / analysis_* /
	// page_html_*) plus the standalone log tables
	// (crawl_errors / inventory_runs). MUST run after
	// {@link createEntityTables} so the FK targets exist. DDL +
	// column-level rationale lives in {@link createAdjunctTables}, which is
	// shared with `scripts/migrate-to-0.13.mjs` — a divergence between the
	// two paths is exactly how migrated archives ended up with stale
	// `REFERENCES pages(id)` declarations in the pre-0.13 era.
	await createAdjunctTables(instance);
}
