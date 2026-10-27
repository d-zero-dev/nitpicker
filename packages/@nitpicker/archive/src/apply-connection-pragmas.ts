import type { Knex } from 'knex';

/**
 * Applies the connection-level PRAGMAs that govern foreign-key enforcement
 * and BLOB-read performance. These are **per-connection** settings (libsql
 * resets them when a new connection is opened), so they must be reapplied
 * every time `Database.connect` runs — not just on first-time schema
 * initialization. Keeping them separate from `initSchema`'s one-shot path
 * also lets `page_size` (which only takes effect against an empty DB)
 * stay gated behind the existence check.
 *
 * The `cache_size` and `mmap_size` values are tuned for reads. The viewer
 * read model build swaps the two for its one long bulk write through
 * `withBulkWritePragmas`, which puts back the values it found afterwards.
 * @param instance - The Knex query builder instance connected to the database.
 * @example
 * await applyConnectionPragmas(knex); // right after the connection opens
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
