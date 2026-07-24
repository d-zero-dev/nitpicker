import type { ListViewerPagesOptions } from './types.js';
import type { Knex } from 'knex';

/**
 * Applies every `ListViewerPagesOptions` filter as `WHERE` predicates on a
 * `viewer_pages`-scoped query builder. Shared by the id-resolution query and
 * the total-count query so both see exactly the same row set.
 *
 * Every predicate targets an indexed `viewer_pages` column, or (for
 * `templateKey`) a `WHERE page_id IN (subquery)` against a narrow
 * `page_id`-PK'd auxiliary table — never the wide write-model `pages` table.
 * The wide table itself is joined in only after LIMIT, once the row set is
 * small, so the wide read stays bounded.
 * @param qb - A Knex query builder scoped to `viewer_pages` (or a subquery
 *   selecting from it).
 * @param options - The filter options to apply.
 */
export function applyViewerPagesFilters(
	qb: Knex.QueryBuilder,
	options: ListViewerPagesOptions,
): void {
	if (options.isExternal != null) {
		qb.where('is_external', options.isExternal ? 1 : 0);
	}
	if (options.contentTypeCategory) {
		qb.where('content_category', options.contentTypeCategory);
	} else {
		// Pre-classified equivalent of `listPages`'s default HTML-or-null base
		// restriction: `classifyContentType(null) === 'unknown'` and
		// `classifyContentType('text/html') === 'html'`.
		qb.whereIn('content_category', ['html', 'unknown']);
	}
	// Filter on `status_sort_key`, not the raw `status` column: `vp_status` /
	// `vp_status_desc` lead with `status_sort_key`/`status_desc_key`, not
	// `status` itself, so a predicate on `status` can't seek either index and
	// falls back to whichever index best matches `is_external`/
	// `content_category` alone (e.g. `vp_source`) followed by a row-by-row
	// filter — no full table scan, but not the index-seek the 100ms contract
	// wants either. `status_sort_key` is a strictly monotonic transform of
	// `status` (real values pass through unchanged; `null` becomes a sentinel
	// far outside any realistic status/range — see `NULL_STATUS_SENTINEL`'s
	// docs in build-viewer-read-model.ts), so equality/range semantics are
	// unchanged: it still excludes null-status rows exactly like filtering on
	// the raw nullable `status` column did.
	if (options.status != null) {
		qb.where('status_sort_key', options.status);
	}
	if (options.statusMin != null) {
		qb.where('status_sort_key', '>=', options.statusMin);
	}
	if (options.statusMax != null) {
		qb.where('status_sort_key', '<=', options.statusMax);
	}
	if (options.missingTitle) {
		qb.where('has_title', 0);
	}
	if (options.missingDescription) {
		qb.where('has_description', 0);
	}
	if (options.noindex) {
		qb.where('robots_noindex', 1);
	}
	if (options.source) {
		qb.where('source', options.source);
	}
	if (options.templateKey) {
		// `page_templates` is a narrow, `page_id`-PK'd auxiliary table
		// populated by `--templates` (see `hasPageTemplatesTable`'s doc) —
		// like `page_tags`/`page_jsonld`, it is not part of the read-model
		// schema, so filtering by it needs no `viewer_pages` column and no
		// `VIEWER_READ_MODEL_SCHEMA_VERSION` bump. A `whereIn` subquery (not
		// a `JOIN`) keeps `page_templates` out of the FROM clause entirely —
		// `readKeysetWindow`'s generic `SELECT page_id, ...` is shared by
		// every `viewer_*` table, so a joined table with its own `page_id`
		// column would make that unqualified column ambiguous.
		qb.whereIn('page_id', (builder) => {
			builder
				.select('page_id')
				.from('page_templates')
				.where('template_key', options.templateKey);
		});
	}
	if (options.directory) {
		const dir = options.directory.endsWith('/')
			? options.directory
			: `${options.directory}/`;
		// `>=`/`<` range on `path_sort_key`, not a LIKE — always seeks the
		// `vp_path` index regardless of collation, unlike a `LIKE 'dir%'`
		// pattern (whose index-seek eligibility depends on SQLite's LIKE
		// optimization and the column's case sensitivity settings). The upper
		// bound is `dir` plus the highest BMP code point (`￿`), a
		// sentinel no real path segment sorts past.
		qb.where('path_sort_key', '>=', dir).where('path_sort_key', '<', `${dir}￿`);
	}
}
