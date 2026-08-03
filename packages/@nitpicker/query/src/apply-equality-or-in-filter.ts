import type { Knex } from 'knex';

import { SQLITE_IN_CHUNK } from './sqlite-in-chunk.js';

/**
 * Applies an equality (`WHERE col = v`) or set-membership (`WHERE col IN
 * (...)`) predicate depending on whether `value` is a scalar or array.
 * `undefined`, `null`, and an empty array are all treated as "no filter" —
 * this mirrors the client's own "empty selection = filter cleared" contract
 * (`useUrlFilter`'s `updateMany` strips empty arrays from the URL before a
 * request is ever sent), so a caller that somehow still passes `[]` behaves
 * the same as passing nothing rather than matching zero rows.
 * @param qb - The query builder to constrain.
 * @param column - The physical column name (already resolved — e.g.
 *   `status_sort_key`, not the public `status` filter name).
 * @param value - A scalar, an array of scalars, or `undefined`/`null`.
 * @example
 * applyEqualityOrInFilter(qb, 'status_sort_key', options.status);
 * // options.status: number | number[] | undefined
 */
export function applyEqualityOrInFilter<T extends string | number>(
	qb: Knex.QueryBuilder,
	column: string,
	value: T | readonly T[] | null | undefined,
): void {
	if (value == null) return;
	if (!Array.isArray(value)) {
		qb.where(column, value);
		return;
	}
	const values = [...new Set(value)];
	if (values.length === 0) return;
	if (values.length <= SQLITE_IN_CHUNK) {
		qb.whereIn(column, values);
		return;
	}
	qb.where((builder) => {
		for (let i = 0; i < values.length; i += SQLITE_IN_CHUNK) {
			builder.orWhereIn(column, values.slice(i, i + SQLITE_IN_CHUNK));
		}
	});
}
