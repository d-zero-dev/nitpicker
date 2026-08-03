import type { Knex } from 'knex';

/**
 * Creates every index for the viewer-read-model tables `createViewerReadModelTables`
 * builds. Callers (`buildViewerReadModel`) must call this AFTER each table's
 * full bulk load completes, not alongside `createViewerReadModelTables` —
 * measured against a real ~11 GB / ~9.7M-distinct-edge archive, maintaining
 * `viewer_anchor_facts`'s 6 indexes incrementally during a chunked bulk
 * insert degraded from ~14µs/row to over 30µs/row as the table grew (the
 * classic B-tree-maintenance-during-bulk-load cost), and the whole
 * `viewer_anchor_facts` phase did not finish inside 29 minutes. Loading the
 * same table with no indexes, then building all 6 in one pass afterward,
 * took under 2 minutes end to end on the same archive (SQLite builds an
 * index via a single sorted scan, which is far cheaper than one B-tree
 * insert-and-rebalance per row). This isn't specific to `viewer_anchor_facts`
 * — every indexed table in this read model gets the same treatment.
 * @param trx - An open Knex transaction (a plain `Knex` instance also works,
 *   e.g. in tests that don't need transactional rollback). Must be run after
 *   every table this function indexes has already been fully populated.
 * @example
 * await createViewerReadModelTables(trx);
 * // ...bulk-load every table...
 * await createViewerReadModelIndexes(trx);
 */
export async function createViewerReadModelIndexes(trx: Knex): Promise<void> {
	await trx.raw(
		'CREATE INDEX vp_default ON viewer_pages(is_external, content_category, natural_url_rank, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_status ON viewer_pages(is_external, content_category, status_sort_key, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_status_desc ON viewer_pages(is_external, content_category, status_desc_key, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_title ON viewer_pages(is_external, content_category, title_sort_key, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_missing_title ON viewer_pages(is_external, content_category, has_title, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_missing_description ON viewer_pages(is_external, content_category, has_description, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_noindex ON viewer_pages(is_external, content_category, robots_noindex, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_source ON viewer_pages(is_external, content_category, source, url_sort_key, page_id)',
	);

	// `directory` (a `path_sort_key` range scan — see `applyViewerPagesFilters`'s
	// docs) narrows the row set to one subtree first; the subsequent
	// `ORDER BY` (`url_sort_key` by default) then re-sorts that already-small
	// subset via `USE TEMP B-TREE FOR ORDER BY` rather than a covering index
	// scan. That's an acceptable trade for now — the whole point of this
	// index is to replace a full-table LIKE scan with a bounded range seek,
	// which the subtree is regardless of how the result then gets sorted. No
	// `is_external`/`content_category` prefix (unlike `vp_default` etc.):
	// `directory` is always paired with an explicit `contentTypeCategory` in
	// its one caller (the directory-tree view's Pages hand-off), but nothing
	// in `ListViewerPagesOptions` requires that pairing, so a bare
	// `path_sort_key` lead keeps this index correct for `directory` alone too.
	await trx.raw('CREATE INDEX vp_path ON viewer_pages(path_sort_key, page_id)');

	// `getDirectoryTree` filters `depth <= 3` (a range, not an equality) and
	// orders by `path_sort_key` alone (grouping into per-root_key buckets
	// happens in JS afterward — see that function's docs). Leading the index
	// with `path_sort_key` lets SQLite satisfy the `ORDER BY` via a plain
	// ascending index scan with `depth` checked as a cheap residual filter,
	// instead of falling back to `USE TEMP B-TREE FOR ORDER BY`. Leading with
	// `root_key`/`depth` instead (the natural shape for a
	// single-root-per-request query) would not help here:
	// a range condition on a non-leading column can't be used to avoid a sort
	// on a column that comes after it — the same index-column-order pitfall
	// `idx_pages_listfilter` hit (see ARCHITECTURE.md).
	await trx.raw(
		'CREATE INDEX vdn_path_depth ON viewer_directory_nodes(path_sort_key, depth, node_id)',
	);
	await trx.raw(
		'CREATE INDEX vdn_parent_name ON viewer_directory_nodes(parent_node_id, name_sort_key, node_id)',
	);

	await trx.raw(
		'CREATE INDEX vdp_node_url ON viewer_directory_pages(node_id, page_url_sort_key, page_id)',
	);

	// No `_desc_key` columns like `viewer_pages` needs: pagination here is
	// plain offset-based (via `paginateQuery`), not keyset-cursor, so a
	// single ascending index scanned backward is enough for DESC.
	await trx.raw(
		'CREATE INDEX vel_url ON viewer_external_links(dest_url_ref_id, dest_page_id)',
	);
	await trx.raw(
		'CREATE INDEX vel_status ON viewer_external_links(status, dest_url_ref_id, dest_page_id)',
	);
	await trx.raw(
		'CREATE INDEX vel_referrer_count ON viewer_external_links(referrer_count, dest_url_ref_id, dest_page_id)',
	);

	await trx.raw(
		'CREATE INDEX vaf_broken_source ON viewer_anchor_facts(is_broken, source_url_ref_id, edge_id)',
	);
	await trx.raw(
		'CREATE INDEX vaf_broken_dest ON viewer_anchor_facts(is_broken, dest_url_ref_id, edge_id)',
	);
	await trx.raw(
		'CREATE INDEX vaf_broken_status ON viewer_anchor_facts(is_broken, status_sort_key, source_url_ref_id, edge_id)',
	);
	await trx.raw(
		'CREATE INDEX vaf_broken_status_desc ON viewer_anchor_facts(is_broken, status_desc_key, source_url_ref_id, edge_id)',
	);
	await trx.raw(
		'CREATE INDEX vaf_source ON viewer_anchor_facts(source_page_id, edge_id)',
	);
	await trx.raw('CREATE INDEX vaf_dest ON viewer_anchor_facts(dest_page_id, edge_id)');

	// Indexing is intentionally minimal: unlike `viewer_pages`/
	// `viewer_anchor_facts` (hundreds of thousands to millions of rows), this
	// table's cardinality is bounded by distinct(host)×distinct(kind) —
	// realistically at most a few thousand rows even on a huge archive — so a
	// full-table scan+sort for the `host`/`kind` text sorts is already
	// sub-millisecond in SQLite. Only `count` (the default sort,
	// most-failures-first) gets a dedicated index; add more if a real
	// benchmark ever shows otherwise (see issue #106's evidence-before-indexing
	// precedent). No separate `host_sort_key`/`kind_sort_key` columns either
	// (unlike `viewer_pages.url_sort_key`): `host`/`kind` are never
	// transformed anywhere in this codebase, so `ORDER BY host`/`ORDER BY kind`
	// directly is exactly as correct and needs no extra columns to stay that
	// way.
	await trx.raw('CREATE INDEX vee_count ON viewer_error_kind_entries(count)');

	await trx.raw(
		'CREATE INDEX vic_size_url ON viewer_isolated_components(size, representative_url_sort_key, component_id)',
	);
	await trx.raw(
		'CREATE INDEX vic_cluster_order ON viewer_isolated_components(size_desc_key, representative_url_sort_key, component_id)',
	);
	await trx.raw(
		'CREATE INDEX vic_representative ON viewer_isolated_components(representative_url, component_id)',
	);
	await trx.raw(
		'CREATE INDEX vicp_component_page ON viewer_isolated_component_pages(component_id, url_sort_key, page_id)',
	);

	await trx.raw(
		'CREATE INDEX vgn_indegree ON viewer_graph_nodes(indegree desc, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vge_source_target ON viewer_graph_edges(source_page_id, target_page_id)',
	);
	await trx.raw(
		'CREATE INDEX vge_target_source ON viewer_graph_edges(target_page_id, source_page_id)',
	);

	// Both an `is_external`-prefixed AND a bare `url_sort_key`-first index
	// exist for `url`/`status` order: `bench-viewer-resources-read-model.mjs`
	// measured the unfiltered default view (no `isExternal` filter — the
	// common case) falling back to `SCAN … | USE TEMP B-TREE FOR ORDER BY`
	// with only the `is_external`-prefixed indexes present (400k-row archive:
	// 29.5ms fast path vs 26.3ms live — a regression, not an improvement),
	// because a composite index whose leading column is unconstrained can't
	// satisfy an `ORDER BY` on a later column without an extra sort step. The
	// `_order`-suffixed indexes below (no `is_external` prefix) give the
	// unfiltered case a direct index-order scan; the planner still picks the
	// `is_external`-prefixed index when that filter IS supplied. Fast path
	// listing only supports `sortBy` in `url`/`status` (resources) or
	// `url`/`status`/`source` (unused-resources) — the remaining
	// `ListResourcesOptions.sortBy` values (`statusText`/`contentType`/
	// `isExternal`/`referrerCount`/`compress`/`cdn`) fall back to the live
	// query rather than gaining dedicated indexes here, following #106's
	// evidence-before-indexing precedent.
	await trx.raw(
		'CREATE INDEX vr_default ON viewer_resources(is_external, url_sort_key, resource_id)',
	);
	await trx.raw(
		'CREATE INDEX vr_url_order ON viewer_resources(url_sort_key, resource_id)',
	);
	await trx.raw(
		'CREATE INDEX vr_status ON viewer_resources(is_external, status_sort_key, url_sort_key, resource_id)',
	);
	await trx.raw(
		'CREATE INDEX vr_status_desc ON viewer_resources(is_external, status_desc_key, url_sort_key, resource_id)',
	);
	await trx.raw(
		'CREATE INDEX vr_status_order ON viewer_resources(status_sort_key, url_sort_key, resource_id)',
	);
	await trx.raw(
		'CREATE INDEX vr_status_desc_order ON viewer_resources(status_desc_key, url_sort_key, resource_id)',
	);
	await trx.raw(
		'CREATE INDEX vr_unused ON viewer_resources(is_unused, url_sort_key, resource_id)',
	);
	await trx.raw(
		'CREATE INDEX vr_unused_status ON viewer_resources(is_unused, status_sort_key, url_sort_key, resource_id)',
	);
	await trx.raw(
		'CREATE INDEX vr_unused_status_desc ON viewer_resources(is_unused, status_desc_key, url_sort_key, resource_id)',
	);
	await trx.raw(
		'CREATE INDEX vr_unused_source ON viewer_resources(is_unused, source, url_sort_key, resource_id)',
	);

	// Image-list read model (issue #113). `vi_default` serves the unfiltered
	// default (`sortBy: 'pageUrl'`) view; `vi_missing_alt`/
	// `vi_missing_dimensions` serve that same default order once one of the
	// two boolean filters is applied — unlike `viewer_resources`'s
	// `is_external`, neither filter is ever the table's implicit default
	// predicate, so (following #110's "bare AND prefixed" lesson) a
	// filtered request still needs its own prefixed index rather than
	// falling back to a full-table scan of the bare `vi_default` index.
	// `vi_width`/`vi_height`/`vi_natural_width`/`vi_natural_height`/
	// `vi_is_lazy` serve the five non-default `sortBy` values the fast path
	// also supports (see `getViewerImagesSortSpec`) — bare, single-column
	// indexes only, no `missing_alt`/`missing_dimensions`-prefixed variants
	// for them: these are less-common sort choices than the page-order
	// default, and #106/#118's evidence-before-indexing precedent argues
	// against pre-building every filter×sort combination without a
	// measured need. `oversizedThreshold` deliberately gets NO dedicated
	// index at all (see `applyViewerImagesFilters`'s docs) — an arbitrary
	// runtime threshold over `natural_width`/`natural_height` can't be
	// served by a fixed-value index, and a covering index over a column pair
	// used only for occasional inequality filters is exactly the "wide
	// covering index" issue #113 asks to avoid.
	await trx.raw('CREATE INDEX vi_default ON viewer_images(page_url_rank, image_id)');
	await trx.raw(
		'CREATE INDEX vi_missing_alt ON viewer_images(missing_alt, page_url_rank, image_id)',
	);
	await trx.raw(
		'CREATE INDEX vi_missing_dimensions ON viewer_images(missing_dimensions, page_url_rank, image_id)',
	);
	await trx.raw('CREATE INDEX vi_width ON viewer_images(width, image_id)');
	await trx.raw('CREATE INDEX vi_height ON viewer_images(height, image_id)');
	await trx.raw(
		'CREATE INDEX vi_natural_width ON viewer_images(natural_width, image_id)',
	);
	await trx.raw(
		'CREATE INDEX vi_natural_height ON viewer_images(natural_height, image_id)',
	);
	await trx.raw('CREATE INDEX vi_is_lazy ON viewer_images(is_lazy, image_id)');

	// Header-check read model (issue #119). `vh_missing` deliberately leads
	// with the boolean `is_missing` flag rather than the raw `missing_count`
	// tally: `missing_count > 0` is a RANGE predicate, and an
	// index leading with a range-constrained column cannot also satisfy
	// `ORDER BY url_sort_key` — SQLite would scan each distinct
	// `missing_count` value's url-sorted run in turn (1, 2, 3, 4), not one
	// globally url-sorted pass, forcing `USE TEMP B-TREE FOR ORDER BY`
	// (confirmed via `EXPLAIN QUERY PLAN` — this is why `viewer_pages` itself
	// indexes boolean flags like `has_title`, never a count, ahead of a sort
	// key). `is_missing`'s equality predicate has no such problem. No indexes
	// for the individual `has_csp`/`has_x_frame_options`/
	// `has_x_content_type_options`/`has_hsts` equality filters — following
	// #106/#118's evidence-before-indexing precedent, these are rarer filter
	// combinations than `missingOnly`, and `getHeaderChecksFastPath` bails to
	// the live path for any explicit `sortBy` regardless.
	await trx.raw(
		'CREATE INDEX vh_missing ON viewer_header_checks(is_missing, url_sort_key, page_id)',
	);
	await trx.raw('CREATE INDEX vh_default ON viewer_header_checks(url_sort_key, page_id)');

	// Duplicate-metadata group read model (issue #115). `vdg_field_count`
	// leads with `field` (an equality predicate every read always supplies —
	// see `ListViewerDuplicateGroupsOptions.field`'s required, not optional,
	// docs) so the default most-duplicated-first `ORDER BY count_desc_key`
	// stays a single index-order scan, the same "equality-then-sort-key"
	// shape as `vh_default`. No dedicated index for `value` (the shared
	// duplicate text itself): nothing filters or sorts by it — it is only
	// ever read back as display data after the id set is already
	// limit-bounded by `count_desc_key`.
	await trx.raw(
		'CREATE INDEX vdg_field_count ON viewer_duplicate_groups(field, count_desc_key, group_id)',
	);

	// `viewer_duplicate_group_pages` DOES need a dedicated index, despite its
	// `(group_id, page_id)` composite `PRIMARY KEY` on a `WITHOUT ROWID`
	// table: that primary key clusters by `page_id` within a `group_id`, but
	// `listViewerDuplicateGroupPages`/`listViewerDuplicateGroups`'s
	// window-function sample query both order member pages by
	// `(url_sort_key, page_id)`, not `page_id` alone. `EXPLAIN QUERY PLAN`
	// against `WHERE group_id = ? ORDER BY url_sort_key, page_id` with only
	// the primary key present confirms `SEARCH ... USING PRIMARY KEY
	// (group_id=?)` followed by `USE TEMP B-TREE FOR ORDER BY` — for a
	// duplicate group with thousands of member pages (common CMS-boilerplate
	// titles on large sites), every read re-sorts the entire group from
	// scratch. `vdgp_group_url` fixes this the same "equality-then-sort-key"
	// way as `vdg_field_count`/`vm_type_url`.
	await trx.raw(
		'CREATE INDEX vdgp_group_url ON viewer_duplicate_group_pages(group_id, url_sort_key, page_id)',
	);

	// Metadata-mismatch read model (issue #115). `vm_type_url` leads with
	// `type` (an equality predicate every read always supplies — see
	// `ListViewerMismatchesOptions.type`'s required, not optional, docs), the
	// same "equality-then-sort-key" shape as `vdg_field_count`/`vh_default`
	// above. No `status_desc_key`-style descending twin: fast-path listing
	// only supports `sortBy` on `url_sort_key` (see
	// `ListViewerMismatchesOptions`'s docs for why `actual`/`expected`
	// sorting bails to the live `findMismatches` path instead), and a
	// single ascending index scanned backward already serves `sortOrder:
	// 'desc'` with no separate descending-key column needed — the exact
	// `vel_*`/`vaf_*` distinction: `viewer_external_links` (offset
	// pagination, no descending column) versus `viewer_anchor_facts` (keyset
	// pagination, needs one). `viewer_mismatches` uses keyset pagination too,
	// but keyset DESC over a single already-monotonic text column doesn't
	// need a sign-flipped twin the way an INTEGER `status` column does — a
	// `text` column has no arithmetic negation, so reversing scan direction
	// (not a negated key) is how SQLite walks it backward.
	await trx.raw(
		'CREATE INDEX vm_type_url ON viewer_mismatches(type, url_sort_key, mismatch_id)',
	);
}
