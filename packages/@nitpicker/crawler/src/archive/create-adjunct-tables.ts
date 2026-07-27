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
 * - `analysis_text_refs` + `analysis_violations` — analyze-phase findings,
 *   FK → `content_items(id)`
 * - `page_templates` — DOM-structure template classification (`--templates`,
 *   `@nitpicker/core`'s `template-classification/`), one row per classified
 *   page, FK → `content_items(id)`
 * - `page_html_blobs` + `page_html_ref` — content-addressable HTML
 *   snapshots, FK → `content_items(id)`
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
}
