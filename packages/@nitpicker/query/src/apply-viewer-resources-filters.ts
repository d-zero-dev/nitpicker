import type { ListViewerResourcesOptions } from './types.js';
import type { Knex } from 'knex';

import { applyEqualityOrInFilter } from './apply-equality-or-in-filter.js';

/**
 * Applies every `ListViewerResourcesOptions` filter as `WHERE` predicates on
 * a `viewer_resources`-scoped query builder. Shared by the id-resolution
 * query and the total-count query so both see exactly the same row set.
 *
 * Every predicate here targets an indexed `viewer_resources` column (never
 * the wide write-model `resources` table) — this function runs BEFORE any
 * join, on the narrow read model only; the wide table is joined in only
 * after LIMIT, once the row set is small, so the wide read stays bounded.
 * @param qb - A Knex query builder scoped to `viewer_resources` (or a
 *   subquery selecting from it).
 * @param options - The filter options to apply.
 */
export function applyViewerResourcesFilters(
	qb: Knex.QueryBuilder,
	options: ListViewerResourcesOptions,
): void {
	if (options.isExternal != null) {
		qb.where('is_external', options.isExternal ? 1 : 0);
	}
	// Filter on `status_sort_key`, not the raw `status` column — same
	// `applyViewerPagesFilters` rationale (the sentinel-substituted column is
	// what the indexes are built on, and is a strictly monotonic transform of
	// `status` so equality semantics are unchanged).
	applyEqualityOrInFilter(qb, 'status_sort_key', options.status);
	if (options.urlPattern) {
		// Plain LIKE scan of the inlined URL text — a substring LIKE can't
		// seek an index anyway, and the narrow read model is what makes the
		// scan cheap (same shape as `applyViewerPagesFilters`'s canonical arm).
		qb.where('url_sort_key', 'like', options.urlPattern);
	}
	if (options.contentType) {
		// Prefix match on the verbatim raw MIME string, matching live
		// `listResources`'s `ctr.raw LIKE '<prefix>%'` semantics exactly.
		qb.where('content_type_raw', 'like', `${options.contentType}%`);
	}
}
