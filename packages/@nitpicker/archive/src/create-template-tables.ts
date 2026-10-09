import type { Knex } from 'knex';

/**
 * Creates the DOM-structure template classification tables. Kept apart from
 * `createAdjunctTables` because the classification is a derived,
 * archive-wide computation produced by its own crawl-end step
 * (`classifyArchivePageTemplates`), not an observation the crawler writes per
 * page.
 *
 * - `page_templates` — one row per classified page, FK → `content_items(id)`
 * - `page_template_clusters` — one row per distinct `page_templates.template_key`,
 *   holding `@d-zero/page-cluster`'s cluster-selection evidence (no FK;
 *   `template_key` is not a `page_templates` FK target, so consistency is
 *   maintained by replacing both tables together, not by a foreign key)
 * - `page_template_labels` — one row per template key: the stable
 *   human-facing name (`events template A`) carried forward across
 *   re-classifications (no FK, same reason)
 *
 * Each table is guarded individually (same convergence rule as
 * `createAdjunctTables`) and `initSchema` runs this on every open, so
 * archives created before these tables existed gain them on their next
 * writer open. MUST run after `createEntityTables` because `page_templates`
 * references `content_items(id)`.
 * @param instance - The Knex query builder instance connected to the database.
 * @example
 * await createEntityTables(db);
 * await createTemplateTables(db);
 */
export async function createTemplateTables(instance: Knex): Promise<void> {
	// One row per internal HTML page that was classified; `page_id` is both
	// the PK and the natural key (1:1 with `content_items`), so
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

	// One row per distinct `template_key` produced by the same classification
	// run, holding `@d-zero/page-cluster`'s cluster-selection evidence
	// (`ClusterReason`, renamed `TemplateClusterReason` on this side) as a
	// zstd-compressed JSON blob — same BLOB+codec+size shape as
	// `page_html_blobs`. A column on `page_templates` was rejected: that
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

	// One row per distinct `page_templates.template_key`: the human-facing
	// label (`<section> template <letter>`) assigned to that cluster by
	// `assignTemplateLabels` when `replacePageTemplates` wrote it. Stored
	// rather than derived at read time because a label's whole point is to
	// stay attached to the same template across re-classifications, and
	// nothing derivable from the key alone survives one — `cluster:<n>` is
	// the library's per-run index and `css:<hash>` changes with the
	// stylesheet set. `replacePageTemplates` carries labels forward by member
	// overlap against the previous run's `page_templates` before replacing
	// it. Kept apart from `page_template_clusters` because that table's rows
	// are best-effort (a cluster may have no captured reason) while every
	// cluster gets a label. `section` is NULL for a site-wide label (members
	// span several top-level directories). No FK, same reasoning as
	// `page_template_clusters`.
	if (!(await instance.schema.hasTable('page_template_labels'))) {
		await instance.raw(`
			CREATE TABLE page_template_labels (
				template_key TEXT PRIMARY KEY,
				section      TEXT,
				ordinal      INTEGER NOT NULL
			) WITHOUT ROWID
		`);
	}
}
