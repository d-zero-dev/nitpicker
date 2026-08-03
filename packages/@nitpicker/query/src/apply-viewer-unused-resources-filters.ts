import type { ListViewerUnusedResourcesOptions } from './types.js';
import type { Knex } from 'knex';

import { applyEqualityOrInFilter } from './apply-equality-or-in-filter.js';

/**
 * Applies the fixed `is_unused = 1` base predicate plus every
 * `ListViewerUnusedResourcesOptions` filter as `WHERE` predicates on a
 * `viewer_resources`-scoped query builder. Shared by the id-resolution query
 * and the total-count query so both see exactly the same row set.
 *
 * No `is_external` predicate is needed: `computeResourceInsertRows` never
 * sets `is_unused = 1` for an external resource (see that function's docs),
 * so the fixed `is_unused = 1` filter already excludes them.
 * @param qb - A Knex query builder scoped to `viewer_resources` (or a
 *   subquery selecting from it).
 * @param options - The filter options to apply.
 */
export function applyViewerUnusedResourcesFilters(
	qb: Knex.QueryBuilder,
	options: ListViewerUnusedResourcesOptions,
): void {
	qb.where('is_unused', 1);
	applyEqualityOrInFilter(qb, 'status_sort_key', options.status);
	applyEqualityOrInFilter(qb, 'source', options.source);
}
