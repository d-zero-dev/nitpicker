import type { Knex } from 'knex';

/**
 * Creates the adjunct tables that hang off `content_items` (plus the two
 * standalone log tables), guarded per-table so partially-provisioned
 * archives converge to the full set:
 *
 * - `page_errors` — partial scrape failures, FK → `content_items(id)`
 * - `crawl_errors` — crawler-level error channel (no FK; the URL may be
 *   an external link that failed DNS, or null for a process-level error)
 * - `page_tags` — Wappalyzer detections, FK → `content_items(id)`
 * - `page_jsonld` — JSON-LD / SpeculationRules, FK → `content_items(id)`
 * - `page_main_content_headings` / `_images` / `_tables` / `_buttons` /
 *   `_iframes` / `_videos` / `_audios` / `_canvases` — beholder
 *   `MainContentsData` sub-entity arrays, one row per DOM element, FK →
 *   `content_items(id)`
 * - `inventory_runs` — `--inventory` audit log (no FK; append-only)
 * - `network_outages` — operator-network-outage journal (no FK; append-only
 *   except `ended_at`, which is written once on recovery)
 * - `dedupe_cap_events` — `--dedupe-cap` same-cluster soft-cap audit log (no
 *   FK; append-only except `rejected_count`, which is written once at
 *   `crawlEnd`)
 * - `analysis_text_refs` + `analysis_violations` — analyze-phase findings,
 *   FK → `content_items(id)`
 * - `page_templates` — DOM-structure template classification (`--templates`,
 *   `@nitpicker/core`'s `template-classification/`), one row per classified
 *   page, FK → `content_items(id)`
 * - `page_template_clusters` — one row per distinct `page_templates.template_key`,
 *   holding `@d-zero/page-cluster`'s cluster-selection evidence (no FK;
 *   `template_key` is not a `page_templates` FK target, so consistency is
 *   maintained by replacing both tables together, not by a foreign key)
 * - `page_html_blobs` + `page_html_ref` — content-addressable HTML
 *   snapshots, FK → `content_items(id)`
 * - `console_log_items` — content-addressable dictionary of distinct
 *   console messages / page errors (no FK; hash-deduplicated across every
 *   page in the archive, mirroring `text_refs` / `json_refs`)
 * - `page_console_logs` — one row per (page, console log) occurrence, FK →
 *   `content_items(id)` and `console_log_items(id)`
 *
 * The DDL is shared between fresh-archive provisioning ({@link initSchema}
 * calls this right after `createEntityTables`) and the migration script
 * (`scripts/migrate-to-0.13.mjs` calls it before retargeting FK
 * declarations and dropping the legacy tables). Keeping the schema in one
 * function guarantees both origin points produce identical tables — the
 * pre-0.13 era kept per-table copies of this DDL in separate lazy-migration
 * modules, and those copies drifted: they declared `REFERENCES pages(id)`
 * while `initSchema` had moved on to `content_items(id)`, leaving migrated
 * archives with stale FK targets that only `scripts/migrate-to-0.13.mjs`'s
 * rename-copy-drop pass can now repair.
 *
 * Unlike `createRefTables` / `createEntityTables` (whose callers guard with
 * a single sentinel table), each table here is guarded individually because
 * the migration-script caller sees archives where any subset may already
 * exist (e.g. `page_tags` from the 0.10 migration but no `inventory_runs`).
 * Index creation stays inside each guard: an existing table keeps whatever
 * indexes its creation path declared.
 * @param instance - The Knex query builder instance connected to the database.
 * @example
 * // Must run after createEntityTables — the page-scoped tables FK into
 * // content_items(id).
 * await createRefTables(db);
 * await createEntityTables(db);
 * await createAdjunctTables(db);
 */
export async function createAdjunctTables(instance: Knex): Promise<void> {
	if (!(await instance.schema.hasTable('page_errors'))) {
		await instance.schema.createTable('page_errors', (t) => {
			// Records partial scrape failures (e.g. a viewport switch that
			// detaches the frame and trips beholder's @retryable into the
			// `retryExhausted` phase). A page can have zero or more rows here
			// in addition to its normal `content_items` entry — the page
			// itself is considered successfully scraped, but image capture or
			// another secondary step failed for at least one device preset.
			t.increments('id');
			t.integer('pageId').notNullable().unsigned().references('content_items.id');
			t.string('phase').notNullable();
			t.text('message').notNullable();
			t.integer('createdAt').notNullable();

			t.index('pageId');
		});
	}

	if (!(await instance.schema.hasTable('crawl_errors'))) {
		await instance.schema.createTable('crawl_errors', (t) => {
			// Structured form of the crawler-level `error` channel that otherwise
			// only lands in `error.log`. Unlike `page_errors` these are not tied to
			// a scraped page (the URL may be an external link that failed DNS, or
			// null for a process-level error), so there is no `pageId` FK and `url`
			// is nullable. The cause is NOT stored — it is classified on read from
			// `message` so older archives (which only have `error.log`) classify the
			// same way.
			t.increments('id');
			t.string('url', 8190).nullable();
			t.boolean('isExternal');
			t.text('message').notNullable();
			t.integer('createdAt').notNullable();
		});
	}

	if (!(await instance.schema.hasTable('page_tags'))) {
		await instance.schema.createTable('page_tags', (t) => {
			// Wappalyzer-derived technology detection. One row per
			// (provider × externalId) tuple per page. `category` is the first
			// element of `categories`; the full list lives in the JSON
			// `categories` column. `sources` records where the provider was
			// detected (script-src / inline / iframe-src / window-global / …).
			t.increments('id');
			t.integer('pageId')
				.notNullable()
				.unsigned()
				.references('content_items.id')
				.onDelete('CASCADE');
			t.string('provider').notNullable();
			t.string('category');
			t.string('externalId');
			t.string('version');
			t.integer('confidence');
			t.json('categories');
			t.json('sources');

			t.index('pageId');
			t.index('provider');
			t.index('externalId');
		});
		// Compound indexes for the "find duplicate IDs across pages" and
		// "list pages using provider X" hot paths. Knex's schema builder
		// can't express compound indexes inline in a way that round-trips
		// through libsql consistently, so raw SQL is used.
		await instance.raw(
			'CREATE INDEX page_tags_provider_extId ON page_tags(provider, externalId)',
		);
		await instance.raw(
			'CREATE INDEX page_tags_provider_pageId ON page_tags(provider, pageId)',
		);
	}

	if (!(await instance.schema.hasTable('page_jsonld'))) {
		await instance.schema.createTable('page_jsonld', (t) => {
			// JSON-LD and SpeculationRules entries captured from
			// `<script type="application/ld+json">` and
			// `<script type="speculationrules">`. `kind` discriminates; `type`
			// is the top-level `@type` extracted by classify-jsonld-type for
			// indexable filtering. `raw` is stored uncompressed; SQLite
			// overflow pages handle multi-KB JSON bodies transparently.
			t.increments('id');
			t.integer('pageId')
				.notNullable()
				.unsigned()
				.references('content_items.id')
				.onDelete('CASCADE');
			t.string('kind').notNullable();
			t.string('type');
			t.text('raw').notNullable();
			t.json('parsed');
			t.text('parseError');

			t.index('pageId');
			t.index('type');
		});
		// Compound `(type, pageId)` accelerates streaming
		// `list_pages_by_jsonld_type` JOINs.
		await instance.raw(
			'CREATE INDEX page_jsonld_type_pageId ON page_jsonld(type, pageId)',
		);
	}

	// Beholder `MainContentsData` sub-entities, one adjunct table per array
	// (headings/images/tables/buttons/iframes/videos/audios/canvases). Same
	// shape as `page_tags` / `page_jsonld`: `pageId` FK → `content_items(id)`
	// ON DELETE CASCADE, individually guarded so any subset can pre-exist.
	// `order` preserves the DOM traversal order beholder returns the array
	// in (0-based); it is not itself an index target since these tables are
	// always read whole-page via `WHERE pageId = ? ORDER BY "order"`.
	if (!(await instance.schema.hasTable('page_main_content_headings'))) {
		await instance.schema.createTable('page_main_content_headings', (t) => {
			t.increments('id');
			t.integer('pageId')
				.notNullable()
				.unsigned()
				.references('content_items.id')
				.onDelete('CASCADE');
			t.integer('order').notNullable();
			t.text('text');
			t.integer('level').notNullable();

			t.index('pageId');
		});
	}

	if (!(await instance.schema.hasTable('page_main_content_images'))) {
		await instance.schema.createTable('page_main_content_images', (t) => {
			t.increments('id');
			t.integer('pageId')
				.notNullable()
				.unsigned()
				.references('content_items.id')
				.onDelete('CASCADE');
			t.integer('order').notNullable();
			t.string('src', 8190).notNullable();
			t.text('alt').notNullable();

			t.index('pageId');
		});
	}

	if (!(await instance.schema.hasTable('page_main_content_tables'))) {
		await instance.schema.createTable('page_main_content_tables', (t) => {
			t.increments('id');
			t.integer('pageId')
				.notNullable()
				.unsigned()
				.references('content_items.id')
				.onDelete('CASCADE');
			t.integer('order').notNullable();
			t.integer('rows').notNullable();
			t.integer('cols').notNullable();
			t.boolean('hasHeader').notNullable();
			t.boolean('hasFooter').notNullable();
			t.boolean('hasMergedCell').notNullable();

			t.index('pageId');
		});
	}

	if (!(await instance.schema.hasTable('page_main_content_buttons'))) {
		await instance.schema.createTable('page_main_content_buttons', (t) => {
			t.increments('id');
			t.integer('pageId')
				.notNullable()
				.unsigned()
				.references('content_items.id')
				.onDelete('CASCADE');
			t.integer('order').notNullable();
			t.string('nodeName').notNullable();
			t.string('role');
			t.string('type');
			t.text('text');
			t.boolean('disabled').notNullable();

			t.index('pageId');
		});
	}

	if (!(await instance.schema.hasTable('page_main_content_iframes'))) {
		await instance.schema.createTable('page_main_content_iframes', (t) => {
			t.increments('id');
			t.integer('pageId')
				.notNullable()
				.unsigned()
				.references('content_items.id')
				.onDelete('CASCADE');
			t.integer('order').notNullable();
			t.string('src', 8190).notNullable();
			t.text('title');
			t.string('width');
			t.string('height');

			t.index('pageId');
		});
	}

	if (!(await instance.schema.hasTable('page_main_content_videos'))) {
		await instance.schema.createTable('page_main_content_videos', (t) => {
			t.increments('id');
			t.integer('pageId')
				.notNullable()
				.unsigned()
				.references('content_items.id')
				.onDelete('CASCADE');
			t.integer('order').notNullable();
			t.string('src', 8190).notNullable();
			t.string('poster', 8190);
			t.integer('width').notNullable();
			t.integer('height').notNullable();

			t.index('pageId');
		});
	}

	if (!(await instance.schema.hasTable('page_main_content_audios'))) {
		await instance.schema.createTable('page_main_content_audios', (t) => {
			t.increments('id');
			t.integer('pageId')
				.notNullable()
				.unsigned()
				.references('content_items.id')
				.onDelete('CASCADE');
			t.integer('order').notNullable();
			t.string('src', 8190).notNullable();

			t.index('pageId');
		});
	}

	if (!(await instance.schema.hasTable('page_main_content_canvases'))) {
		await instance.schema.createTable('page_main_content_canvases', (t) => {
			t.increments('id');
			t.integer('pageId')
				.notNullable()
				.unsigned()
				.references('content_items.id')
				.onDelete('CASCADE');
			t.integer('order').notNullable();
			t.integer('width').notNullable();
			t.integer('height').notNullable();

			t.index('pageId');
		});
	}

	if (!(await instance.schema.hasTable('inventory_runs'))) {
		await instance.schema.createTable('inventory_runs', (t) => {
			// One row per successful `--inventory <list>` invocation. The
			// archive's audit log of "when did we apply which deploy list
			// at what scale". `.bak` is removed on success so this table
			// is the only durable provenance record. Column semantics live
			// on the `InventoryRunMeta` interface in `archive/types.ts`.
			t.increments('id');
			t.string('ran_at').notNullable();
			t.string('list_label').nullable();
			t.string('source_file_sha256', 64).nullable();
			t.integer('total_lines').nullable();
			t.integer('new_pages').nullable();
			t.integer('new_resources').nullable();
			t.integer('scope_skipped').nullable();
			t.integer('exclude_skipped').nullable();
			t.integer('invalid_skipped').nullable();
			t.text('notes').nullable();
			t.index('ran_at');
		});
	}

	if (!(await instance.schema.hasTable('network_outages'))) {
		await instance.schema.createTable('network_outages', (t) => {
			// One row per detected operator-network outage. The archive's
			// evidence that a run of `dns`/`local-network`-shaped failures
			// was caused by the crawl operator's own connectivity, not the
			// target sites — used to retroactively re-classify `crawl_errors`
			// / `page_errors` rows whose `createdAt` falls inside a window
			// (see `is-within-outage-window.ts`). No index: a crawl session
			// produces at most a handful of these rows, so a full in-memory
			// scan by every consumer is cheaper than maintaining a B-tree
			// that few queries would use (`ARCHITECTURE.md`'s
			// perf-index-is-not-free / evidence-before-indexing rules).
			t.increments('id');
			// Backdated to the earliest error still inside the detector's
			// sliding window at trigger time, NOT the trigger instant —
			// see `NetworkOutageDetector`'s `OutageSuspect.startedAt`.
			t.integer('started_at').notNullable();
			// When the sliding window actually crossed both thresholds.
			t.integer('detected_at').notNullable();
			// NULL until a recovery probe succeeds. A row can also be left
			// NULL forever if the crawl process is killed mid-outage; readers
			// MUST NOT treat a NULL `ended_at` as an unbounded window (that
			// would retroactively cover every later error as
			// network-caused) — see `is-within-outage-window.ts` and the
			// writer-side clamp-on-next-open in `db-ops/outages/`.
			t.integer('ended_at').nullable();
			t.string('probe_host').nullable();
			t.integer('trigger_error_count').notNullable();
			t.integer('trigger_host_count').notNullable();
		});
	}

	if (!(await instance.schema.hasTable('dedupe_cap_events'))) {
		await instance.schema.createTable('dedupe_cap_events', (t) => {
			// One row per URL shape the `--dedupe-cap` same-cluster soft cap
			// (`DedupeCapTracker`) confirmed as a trap during this crawl. No
			// index: a crawl produces at most a handful of these rows (same
			// reasoning as `network_outages`, above).
			t.increments('id');
			// The URL shape key (`computeShapeKey`) that capped — a template
			// with placeholders (e.g. `example.com/news/date/{n}/`), not a
			// literal URL.
			t.string('shape_key').notNullable();
			// One concrete URL matching this shape, captured at cap time so a
			// human reading the audit log can identify what was being
			// crawled — `shape_key` alone is a template, not a navigable URL.
			t.string('sample_url').notNullable();
			// `computeBodyHash` result recorded at cap time. Nullable only in
			// the sense that BLOB columns are nullable by default; every row
			// this feature writes populates it (a page with no rendered
			// `<body>` never reaches the tracker — see `Crawler#handleResult`).
			t.binary('body_hash').nullable();
			// The Misra-Gries threshold that actually triggered the cap,
			// after halving for the `body_hash`-match / `og:url`-mismatch
			// confidence signals — NOT necessarily equal to `--dedupe-cap`'s
			// raw value.
			t.integer('effective_threshold').notNullable();
			// The tracker's Misra-Gries counter value at cap time: a LOWER
			// BOUND on the number of matching-signature pages seen for this
			// shape, not an exact observation count (see `DedupeCapTracker`).
			t.integer('observed_count').notNullable();
			t.integer('detected_at').notNullable();
			// NULL until `crawlEnd` finalizes it (see
			// `Crawler#getDedupeCapRejections`). Unlike `network_outages.ended_at`,
			// a NULL here has no ambiguous "still ongoing" reading — a
			// crawl that never reached `crawlEnd` simply left the count
			// undetermined, so no boot-time reconciliation pass is needed
			// (readers display "unknown", not "0" or "unbounded").
			t.integer('rejected_count').nullable();
		});
	}

	if (!(await instance.schema.hasTable('analysis_text_refs'))) {
		await instance.raw(`
			CREATE TABLE analysis_text_refs (
				id integer primary key,
				text text not null,
				sha256 text not null,
				unique(sha256, text)
			)
		`);
	}
	if (!(await instance.schema.hasTable('analysis_violations'))) {
		await instance.raw(`
			CREATE TABLE analysis_violations (
				id integer primary key,
				page_id integer not null references content_items(id),
				validator text not null,
				severity text not null,
				rule text not null,
				message_text_id integer not null references analysis_text_refs(id),
				code_text_id integer references analysis_text_refs(id),
				page_url_sort_key text not null,
				message_sort_key text not null,
				code_sort_key text not null,
				line integer,
				col integer
			)
		`);
		await instance.raw(
			'CREATE INDEX av_url_order ON analysis_violations(page_url_sort_key, id)',
		);
		await instance.raw(
			'CREATE INDEX av_filter_url ON analysis_violations(validator, severity, rule, page_url_sort_key, id)',
		);
		await instance.raw(
			'CREATE INDEX av_validator_url ON analysis_violations(validator, page_url_sort_key, id)',
		);
		await instance.raw(
			'CREATE INDEX av_severity_url ON analysis_violations(severity, page_url_sort_key, id)',
		);
		await instance.raw(
			'CREATE INDEX av_rule_url ON analysis_violations(rule, page_url_sort_key, id)',
		);
		await instance.raw(
			'CREATE INDEX av_message_order ON analysis_violations(message_sort_key, id)',
		);
		await instance.raw(
			'CREATE INDEX av_code_order ON analysis_violations(code_sort_key, id)',
		);
		await instance.raw('CREATE INDEX av_page ON analysis_violations(page_id, id)');
	}

	// DOM-structure template classification (`--templates`). One row per
	// internal HTML page that was classified; `page_id` is both the PK and
	// the natural key (1:1 with `content_items`), so — unlike
	// `analysis_violations`, which is 1:many and needs a surrogate `id` —
	// there's nothing to index beyond the PK itself. `WITHOUT ROWID` packs
	// rows directly in the PK b-tree, matching `page_html_ref`'s shape
	// (small fixed-width row, PK-only lookups).
	if (!(await instance.schema.hasTable('page_templates'))) {
		await instance.raw(`
			CREATE TABLE page_templates (
				page_id      INTEGER PRIMARY KEY REFERENCES content_items(id),
				template_key TEXT NOT NULL
			) WITHOUT ROWID
		`);
	}

	// One row per distinct `template_key` produced by the same `--templates`
	// classification run, holding `@d-zero/page-cluster`'s cluster-selection
	// evidence (`ClusterReason`, renamed `TemplateClusterReason` on this side)
	// as a zstd-compressed JSON blob — same BLOB+codec+size shape as
	// `page_html_blobs` below. A column on `page_templates` was rejected: that
	// table is one row per *page*, so the same cluster's reason would be
	// duplicated across every member page (multi-GB on a large archive with a
	// few-hundred-member cluster). A `json_refs` row was also rejected: reason
	// payloads differ per cluster (distinct `memberCount`/token sets), so
	// content-address dedup would not pay for itself, and `json_refs` is a
	// shared dictionary that other tables reference — this table's full
	// replace-on-every-run write pattern (see `replacePageTemplates`) would
	// otherwise leave orphaned rows behind with no owner able to delete them.
	// No FK to `page_templates`: `template_key` is not that table's primary
	// key (`page_id` is), so there is nothing to reference — consistency is
	// instead maintained by replacing both tables in the same transaction.
	if (!(await instance.schema.hasTable('page_template_clusters'))) {
		await instance.raw(`
			CREATE TABLE page_template_clusters (
				template_key TEXT PRIMARY KEY,
				member_count INTEGER NOT NULL,
				reason_json  BLOB NOT NULL,
				codec        TEXT NOT NULL CHECK(codec IN ('zstd', 'none')),
				size_raw     INTEGER NOT NULL,
				size_stored  INTEGER NOT NULL
			) WITHOUT ROWID
		`);
	}

	// Content-addressable HTML blob storage. Knex's schema builder doesn't
	// expose a WITHOUT ROWID toggle, so the BLOB tables are created via raw
	// SQL. WITHOUT ROWID keeps the rows packed inside the b-tree leaves
	// (no hidden rowid + secondary index pair), which matters for the blob
	// table where a 32-byte hash PK + multi-KB body is the dominant row
	// shape.
	if (!(await instance.schema.hasTable('page_html_blobs'))) {
		await instance.raw(`
			CREATE TABLE page_html_blobs (
				hash         BLOB PRIMARY KEY,
				body         BLOB NOT NULL,
				codec        TEXT NOT NULL CHECK(codec IN ('zstd', 'none')),
				size_raw     INTEGER NOT NULL,
				size_stored  INTEGER NOT NULL
			) WITHOUT ROWID
		`);
	}
	if (!(await instance.schema.hasTable('page_html_ref'))) {
		await instance.raw(`
			CREATE TABLE page_html_ref (
				page_id  INTEGER PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
				hash     BLOB NOT NULL REFERENCES page_html_blobs(hash)
			) WITHOUT ROWID
		`);
		await instance.raw('CREATE INDEX idx_page_html_ref_hash ON page_html_ref(hash)');
	}

	// Content-addressable dictionary of distinct console messages / page
	// errors (beholder's `ConsoleLogEntry`, issue #228). `hash` is
	// SHA-256 over a canonical tuple of every content field (type, text,
	// args JSON, location, stack) — the same identical warning emitted by
	// a shared framework on every page therefore collapses to one row
	// regardless of how many pages or how many times it fires, mirroring
	// `text_refs` / `json_refs`. `args_json_id` is nullable because a
	// call with no arguments (or one whose args failed to
	// `JSON.stringify`, e.g. a circular reference) has nothing to store.
	// `text_id` is nullable too: `text_refs` never stores the empty
	// string (its dictionary upsert treats `''` as "nothing to dedupe"),
	// so a call like `console.log()` with zero arguments — whose
	// `text` beholder reports as `''` — has no `text_refs` row to point
	// at; `text_id = NULL` there means "empty text", read back as `''`.
	// `type` keeps its own index for the Console Logs view's type filter.
	if (!(await instance.schema.hasTable('console_log_items'))) {
		await instance.raw(`
			CREATE TABLE console_log_items (
				id             INTEGER PRIMARY KEY,
				hash           BLOB NOT NULL UNIQUE,
				type           TEXT NOT NULL,
				text_id        INTEGER REFERENCES text_refs(id),
				args_json_id   INTEGER REFERENCES json_refs(id),
				loc_url_id     INTEGER REFERENCES url_refs(id),
				loc_line       INTEGER,
				loc_column     INTEGER,
				stack_text_id  INTEGER REFERENCES text_refs(id)
			)
		`);
		await instance.raw(
			'CREATE INDEX idx_console_log_items_type ON console_log_items(type)',
		);
	}

	// One row per (page, console log) occurrence — beholder captures a
	// `ts` per firing, so the same message logged 3 times on one page
	// yields 3 rows (unlike `anchor_edges`' first-wins dedup: an
	// occurrence count matters here, not just presence). Replaced
	// wholesale per page on every non-empty scrape by
	// `replaceConsoleLogs`, the same Scoped-Replace pattern as
	// `anchor_edges` / `image_items` — there is no natural key to UPDATE
	// a specific prior occurrence against.
	if (!(await instance.schema.hasTable('page_console_logs'))) {
		await instance.schema.createTable('page_console_logs', (t) => {
			t.increments('id');
			t.integer('pageId')
				.notNullable()
				.unsigned()
				.references('content_items.id')
				.onDelete('CASCADE');
			t.integer('consoleLogId')
				.notNullable()
				.unsigned()
				.references('console_log_items.id');
			t.integer('ts').notNullable();

			t.index('pageId');
			t.index('consoleLogId');
		});
	}
}
