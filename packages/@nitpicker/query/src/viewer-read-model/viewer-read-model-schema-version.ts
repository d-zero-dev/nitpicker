/**
 * Current schema/build version of the viewer read model. Bump this whenever
 * the table shapes or population logic in `viewer-read-model/` change in a
 * way that requires existing archives to rebuild.
 *
 * `ensureViewerReadModel` compares this constant against the persisted
 * `viewer_read_model_meta.schema_version` to decide whether a rebuild is
 * needed.
 *
 * 29 -> 30 (report-google-sheets rewrite): added
 * `viewer_anchor_facts.raw_dest_url_ref_id` (the pre-redirect/alias href
 * target, alongside the already-resolved `dest_url_ref_id`) and three
 * `viewer_pages` columns with no write-model source --
 * `display_title`/`inbound_link_count`/`dir_index_inbound_link_count` --
 * computed once at build time from a `viewer_anchor_facts` tally
 * (`buildingAnchorFacts` moved ahead of `buildingPages` to make this
 * possible in a single pass; see `build-viewer-read-model.ts`).
 *
 * 30 -> 31 (report-google-sheets Page List perf fix): added 12
 * `viewer_pages` columns with no write-model source --
 * `protocol`/`hostname`/`path1`..`path10` -- the same "computed once at
 * build time" category as `display_title` above. Moves
 * `create-page-list.ts`'s per-row `tryParseUrl`/`decodeURISafely` URL
 * decomposition (previously repeated on every `report` run) into
 * `buildViewerReadModel`.
 *
 * 31 -> 32 (report-google-sheets Resources dedupe perf fix): added the
 * `viewer_resource_groups` table (one row per canonical-URL resource
 * group). Moves `create-resources.ts`'s dedupe-mode aggregation
 * (previously re-run in full on every `report` run) into
 * `buildViewerReadModel`'s new `buildingResourceGroups` phase — see
 * `compute-resource-group-rows.ts`.
 *
 * 32 -> 33 (Page List redirect-source rows + `--list` page scope): a
 * redirect-source `content_items` row (`redirect_dest_id IS NOT NULL`) is
 * now admitted into `viewer_pages` as its own row instead of being excluded
 * — three new columns (`is_redirect_source`, `redirect_dest_page_id`,
 * `redirect_dest_url_ref_id`) carry the destination link, and every
 * audit-signal column on such a row is zeroed/nulled out (see
 * `sanitizeRedirectSourceRow` in `build-viewer-read-model.ts`). Separately,
 * a `fromList` archive's internal `viewer_pages` rows are now restricted to
 * pages reachable from `config.roots` (see `compute-from-list-allowed-page-ids.ts`)
 * — excludes an internal page a crawler bug scraped in full despite
 * `--list`'s non-recursive mode, while still admitting a listed root's
 * redirect destination even when that destination URL was never itself on
 * the list.
 *
 * 33 -> 34 (per-viewport image-scan outcome): added `viewer_pages.image_scan_desktop`
 * / `image_scan_mobile` (nullable `INTEGER`, `@d-zero/beholder`'s
 * `IMAGE_SCAN_CODE` copied verbatim from `page_meta`, unlike the `?? 0`
 * count columns — `null` distinguishes "scan never attempted" from `0`
 * ("ok"), the same reasoning as the source `page_meta` columns).
 */
export const VIEWER_READ_MODEL_SCHEMA_VERSION = 34;
