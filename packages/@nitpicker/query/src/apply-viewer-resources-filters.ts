import type { ListViewerResourcesOptions } from './types.js';
import type { Knex } from 'knex';

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
	if (options.status != null) {
		qb.where('status_sort_key', options.status);
	}
}
