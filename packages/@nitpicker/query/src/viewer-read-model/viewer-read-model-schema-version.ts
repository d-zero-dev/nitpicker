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
 */
export const VIEWER_READ_MODEL_SCHEMA_VERSION = 30;
