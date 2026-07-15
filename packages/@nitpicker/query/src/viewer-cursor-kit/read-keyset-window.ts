import type { KeysetSeek, KeysetSortSpec } from './types.js';
import type { Knex } from 'knex';

import { applyKeysetPredicate } from './apply-keyset-predicate.js';

/**
 * Runs one keyset-paginated read against a `viewer_*` table: applies
 * caller-supplied filters, an optional keyset predicate, an `ORDER BY` in
 * `orderDirection`, and `limit + 1` rows (the `+1` lets the caller detect
 * "is there another row past this page" without a second query). Shared by
 * every `viewer_*` table's keyset-cursor orchestrator
 * (`listViewerPages`/`listViewerResources`/`listViewerUnusedResources`/
 * `listViewerBrokenLinks`/`listViewerImages`) — the orchestrators all issue
 * the same filter/keyset/order/limit/offset query shape, differing only in
 * the table name, the filter predicate, and which
 * extra columns to select (id-then-join tables like resources/images select
 * just their id column here and join the wide table afterward;
 * `viewer_anchor_facts` has no join stage and selects its full display
 * column set directly here instead — see `listViewerBrokenLinks`'s docs).
 * @param knex - The archive's Knex instance.
 * @param tableName - The `viewer_*` table to read from.
 * @param applyFilters - Applies the caller's filter predicates (and any
 *   fixed baked-in predicate, e.g. `viewer_anchor_facts`'s `is_broken = 1`)
 *   to the query builder.
 * @param extraSelectColumns - Columns to select beyond `spec.columns` (e.g.
 *   the id column for an id-then-join table, or the full display column set
 *   for a table with no join stage). Deduplicated against `spec.columns`
 *   automatically.
 * @param spec - The resolved sort spec (columns to select/order by).
 * @param orderDirection - The physical scan direction for this read.
 * @param limit - The page size (the read fetches `limit + 1` rows).
 * @param keyset - The keyset predicate to apply, or `undefined` for an
 *   unconstrained (initial / offset) read.
 * @param offset - Row offset for a direct `OFFSET` read (page-number jumps).
 *   Ignored when `keyset` is supplied.
 * @returns Up to `limit + 1` rows carrying every column in
 *   `extraSelectColumns` and `spec.columns`.
 */
export async function readKeysetWindow<Column extends string, Row>(
	knex: Knex,
	tableName: string,
	applyFilters: (qb: Knex.QueryBuilder) => void,
	extraSelectColumns: readonly string[],
	spec: KeysetSortSpec<Column>,
	orderDirection: 'asc' | 'desc',
	limit: number,
	keyset: KeysetSeek | undefined,
	offset: number,
): Promise<Row[]> {
	const qb = knex(tableName);
	applyFilters(qb);
	if (keyset) {
		applyKeysetPredicate(qb, spec.columns, keyset.operator, keyset.values);
	}
	const selectColumns = [...new Set<string>([...extraSelectColumns, ...spec.columns])];
	let query = qb
		.select(selectColumns)
		.orderBy(spec.columns.map((column) => ({ column, order: orderDirection })))
		.limit(limit + 1);
	if (!keyset && offset > 0) {
		query = query.offset(offset);
	}
	return query;
}
