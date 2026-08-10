import type { HeaderPresence, ListViewerPagesOptions } from './types.js';
import type { Knex } from 'knex';

import { applyEqualityOrInFilter } from './apply-equality-or-in-filter.js';
import { hasFilterValue } from './has-filter-value.js';
import { HEADER_FLAG_COLUMN } from './header-presence-sql.js';
import { toFlagValues } from './to-flag-values.js';

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
	applyEqualityOrInFilter(qb, 'is_external', toFlagValues(options.isExternal));
	if (hasFilterValue(options.contentTypeCategory)) {
		applyEqualityOrInFilter(qb, 'content_category', options.contentTypeCategory);
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
	applyEqualityOrInFilter(qb, 'status_sort_key', options.status);
	if (options.statusMin != null) {
		qb.where('status_sort_key', '>=', options.statusMin);
	}
	if (options.statusMax != null) {
		qb.where('status_sort_key', '<=', options.statusMax);
	}
	// `missingTitle: true` selects `has_title = 0` — inverted polarity, so
	// `toFlagValues` maps `true`→`0`/`false`→`1` rather than its 1/0 default.
	applyEqualityOrInFilter(qb, 'has_title', toFlagValues(options.missingTitle, 0, 1));
	if (options.missingDescription) {
		qb.where('has_description', 0);
	}
	if (options.noindex) {
		qb.where('robots_noindex', 1);
	}
	applyEqualityOrInFilter(qb, 'is_dedupe_capped', toFlagValues(options.isDedupeCapped));
	applyEqualityOrInFilter(qb, 'dedupe_cap_event_id', options.dedupeCapEventId);
	applyEqualityOrInFilter(qb, 'lang', options.lang);
	// `viewer_pages` copies header_flags' snake column names verbatim, so
	// the shared HEADER_FLAG_COLUMN mapping resolves them here too.
	for (const key of Object.keys(HEADER_FLAG_COLUMN) as (keyof HeaderPresence)[]) {
		applyEqualityOrInFilter(qb, HEADER_FLAG_COLUMN[key], toFlagValues(options[key]));
	}
	if (options.source) {
		qb.where('source', options.source);
	}
	if (hasFilterValue(options.templateKey)) {
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
			builder.select('page_id').from('page_templates');
			applyEqualityOrInFilter(builder, 'template_key', options.templateKey);
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
	if (options.urlPattern) {
		const urlPattern = options.urlPattern;
		// Canonical-URL LIKE against the narrow `viewer_pages.url` column, OR
		// the redirect-source / alias-member equivalence arms — `viewer_pages`
		// holds only canonical rows, so without the arms a search for a
		// redirect-source URL (e.g. `https://example.com` redirecting to
		// `/index.html`) or an alias-member URL would silently miss the one
		// surviving row, breaking `listPages`'s urlPattern contract (see
		// `ListViewerPagesOptions.urlPattern`'s docs). Each arm mirrors
		// `list-pages.ts`'s own implementation verbatim: `IN` subqueries (not
		// correlated `EXISTS` — computed once as a LIST SUBQUERY) combined by
		// `UNION ALL` (a row is never both a redirect source and an alias
		// member, so no double-counting; each arm keeps its own index-backed
		// plan instead of collapsing into the `OR`-across-nullable-columns
		// full-scan pitfall documented in ARCHITECTURE.md).
		qb.where((outer) => {
			outer.where('url', 'like', urlPattern).orWhereIn('page_id', (sub) => {
				sub
					.select('redirect_ci.redirect_dest_id')
					.from('content_items as redirect_ci')
					.join('url_refs as redirect_ur', 'redirect_ur.id', 'redirect_ci.url_id')
					.whereNotNull('redirect_ci.redirect_dest_id')
					.andWhere('redirect_ur.url', 'like', urlPattern)
					.unionAll((aliasArm) => {
						aliasArm
							.select('alias_ci.alias_of_id')
							.from('content_items as alias_ci')
							.join('url_refs as alias_ur', 'alias_ur.id', 'alias_ci.url_id')
							.whereNotNull('alias_ci.alias_of_id')
							.andWhere('alias_ur.url', 'like', urlPattern);
					});
			});
		});
	}
}
