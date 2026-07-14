import type { Knex } from 'knex';

/**
 * Creates the 10 0.13 staging tables (issue #190) and their index.
 *
 * These are the ref / header dictionary tables that will become the durable
 * write-model under 0.13: `url_refs`, `content_type_refs`,
 * `text_refs`, `json_refs`, `blob_refs`, `header_name_refs`,
 * `header_value_refs`, `header_sets` (+ `idx_header_sets_stable`),
 * `header_set_entries`, `header_flags`.
 *
 * The DDL is shared between fresh-archive provisioning ({@link initSchema}
 * calls this on a brand new DB) and the lazy migration path
 * ({@link migrateRefTables} calls it on archives created before this
 * branch shipped). Keeping the schema in one function guarantees that both
 * origin points produce byte-identical tables — a divergence would silently
 * break the 0.13 population step, which relies on the exact UNIQUE
 * constraints and CHECK clauses declared here.
 *
 * Hash columns store 32-byte BLAKE3 as `BLOB`, matching `page_html_blobs.hash`.
 * `blob_refs` intentionally uses a regular integer rowid PK (unlike
 * `page_html_blobs`) because `image_items.src_blob_id` (added in 0.13)
 * needs a plain integer FK and auto-increment is incompatible with WITHOUT
 * ROWID; `UNIQUE(hash)` still enforces content-addressable dedup.
 *
 * `header_set_entries` is WITHOUT ROWID because the composite PK
 * `(header_set_id, name_id, occurrence)` is the natural clustering key and
 * every column is small — the same reasoning as `page_html_blobs`.
 *
 * `header_sets.raw_json_hash` is a temporary column used only by the
 * 0.13 for lookups against the legacy `responseHeaders` JSON;
 * a follow-up cleanup migration drops it after 0.13 merges.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function createRefTables(instance: Knex): Promise<void> {
	// Unified URL dictionary. `url` is the natural unique key; scheme /
	// host / port / path / query_hash / fragment are pre-decomposed columns
	// filled by the 0.13 population step so filters like
	// "same-host resources" avoid re-parsing the URL string per row.
	// `query_hash` is BLAKE3 of the raw query string — storing query strings
	// inline would defeat dedup on tracker URLs.
	await instance.raw(`
		CREATE TABLE url_refs (
			id         INTEGER PRIMARY KEY,
			url        TEXT NOT NULL UNIQUE,
			scheme     TEXT,
			host       TEXT,
			port       INTEGER,
			path       TEXT,
			query_hash BLOB,
			fragment   TEXT
		)
	`);

	// Content-type dictionary. `raw` is the wire value (unique).
	// `normalized` is the lowercase MIME with parameters stripped;
	// `category` is the coarse bucket used by viewer filters ('html',
	// 'image', ...). Populated in 0.13 by `classifyContentType`.
	await instance.raw(`
		CREATE TABLE content_type_refs (
			id         INTEGER PRIMARY KEY,
			raw        TEXT NOT NULL UNIQUE,
			normalized TEXT NOT NULL,
			category   TEXT NOT NULL
		)
	`);

	// Short-text dictionary. Covers anchor textContent, image alt, page
	// meta strings, and dom_path. The `(hash, text)` composite UNIQUE
	// mirrors `analysis_text_refs` so lookups prefix-seek on `hash`. The
	// two dictionaries stay separate because merging would require
	// re-keying every existing `analysis_violations` row (out of Phase
	// 0.13 migration scope; revisit in a later cleanup pass).
	await instance.raw(`
		CREATE TABLE text_refs (
			id   INTEGER PRIMARY KEY,
			hash BLOB NOT NULL,
			text TEXT NOT NULL,
			UNIQUE(hash, text)
		)
	`);

	// Large JSON payload dictionary. Covers `pages.meta_extras`. `hash` is
	// BLAKE3 of the pre-compression JSON bytes; `codec` records whether
	// `json_text` is zstd-compressed. Sizes are stored so consumers can
	// estimate savings without decompressing.
	await instance.raw(`
		CREATE TABLE json_refs (
			id          INTEGER PRIMARY KEY,
			hash        BLOB NOT NULL UNIQUE,
			json_text   BLOB NOT NULL,
			codec       TEXT NOT NULL CHECK(codec IN ('zstd', 'none')),
			size_raw    INTEGER NOT NULL,
			size_stored INTEGER NOT NULL
		)
	`);

	// Large binary payload dictionary. Covers `data:` URIs longer than
	// 512 bytes attached to `<img>` src / currentSrc. Well-formed http(s)
	// URLs virtually never exceed 512 chars, so this threshold routes all
	// data URIs here without misclassifying URLs.
	await instance.raw(`
		CREATE TABLE blob_refs (
			id          INTEGER PRIMARY KEY,
			hash        BLOB NOT NULL UNIQUE,
			body        BLOB NOT NULL,
			codec       TEXT NOT NULL CHECK(codec IN ('zstd', 'none')),
			size_raw    INTEGER NOT NULL,
			size_stored INTEGER NOT NULL
		)
	`);

	// Response-header decomposition tables. `responseHeaders` on the old
	// `pages` / `resources` tables was a JSON blob whose raw hash barely
	// deduped (99.4 % distinct on the reference archive) because volatile
	// headers like `Date` / `ETag` / `CF-Ray` change every response. The
	// five tables below split header sets into (name, value, occurrence)
	// tuples so a stable-only hash can achieve real dedup, and expose the
	// commonly-checked security flags as pre-computed booleans in
	// `header_flags` so `checkHeaders` no longer needs a per-row LIKE
	// scan.
	await instance.raw(`
		CREATE TABLE header_name_refs (
			id   INTEGER PRIMARY KEY,
			name TEXT NOT NULL UNIQUE
		)
	`);

	await instance.raw(`
		CREATE TABLE header_value_refs (
			id    INTEGER PRIMARY KEY,
			hash  BLOB NOT NULL,
			value TEXT NOT NULL,
			UNIQUE(hash, value)
		)
	`);

	// `raw_json_hash` is BLAKE3 of the raw `responseHeaders` JSON string
	// exactly as stored in the old tables — kept only so the 0.13
	// migration can look up an existing `header_sets.id` without calling
	// any SQL function (SQLite has no built-in BLAKE3). Scheduled for drop
	// in a follow-up cleanup migration after 0.13.
	// `raw_hash` is BLAKE3 of the sorted `name=value` pairs of every
	// header (stable + volatile); `stable_hash` is BLAKE3 of the sorted
	// `name=value` pairs of stable headers only.
	// Both `raw_json_hash` and `raw_hash` are UNIQUE so a JS-side upsert
	// can guarantee dedup — duplicate raw JSON strings map to the same
	// row and same PK.
	// `idx_header_sets_stable` accelerates the "how many pages share this
	// stable header profile" lookup that 0.13 readers use.
	await instance.raw(`
		CREATE TABLE header_sets (
			id                 INTEGER PRIMARY KEY,
			raw_json_hash      BLOB NOT NULL UNIQUE,
			raw_hash           BLOB NOT NULL UNIQUE,
			stable_hash        BLOB NOT NULL,
			volatile_hash      BLOB,
			entry_count        INTEGER NOT NULL,
			stable_entry_count INTEGER NOT NULL
		)
	`);
	await instance.raw('CREATE INDEX idx_header_sets_stable ON header_sets(stable_hash)');

	// `occurrence` is the 1-based index among entries sharing the same
	// `(header_set_id, name_id)` pair. HTTP allows a header name to appear
	// multiple times in one response (e.g. multiple `Set-Cookie` lines);
	// the composite PK preserves all values without truncation.
	await instance.raw(`
		CREATE TABLE header_set_entries (
			header_set_id INTEGER NOT NULL REFERENCES header_sets(id),
			name_id       INTEGER NOT NULL REFERENCES header_name_refs(id),
			occurrence    INTEGER NOT NULL,
			value_id      INTEGER NOT NULL REFERENCES header_value_refs(id),
			is_volatile   INTEGER NOT NULL,
			PRIMARY KEY(header_set_id, name_id, occurrence)
		) WITHOUT ROWID
	`);

	// Pre-computed booleans for the security / caching header checks that
	// `checkHeaders` currently expresses as per-row LIKE predicates over
	// `responseHeaders`. Populated in 0.13 by reusing
	// `headerPresenceExpression`'s logic so the flag rules stay in one
	// place. `cache_policy` is a short summary string captured for display;
	// nullable when the header is absent.
	await instance.raw(`
		CREATE TABLE header_flags (
			header_set_id              INTEGER PRIMARY KEY REFERENCES header_sets(id),
			has_csp                    INTEGER NOT NULL,
			has_x_frame_options        INTEGER NOT NULL,
			has_x_content_type_options INTEGER NOT NULL,
			has_hsts                   INTEGER NOT NULL,
			has_referrer_policy        INTEGER NOT NULL,
			has_permissions_policy     INTEGER NOT NULL,
			has_set_cookie             INTEGER NOT NULL,
			cache_policy               TEXT
		)
	`);
}
