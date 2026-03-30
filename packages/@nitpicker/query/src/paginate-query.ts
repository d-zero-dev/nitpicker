import type { Knex } from 'knex';

/**
 * Options for the {@link paginateQuery} helper.
 * @template TRow - The raw row type from the database query.
 * @template TItem - The mapped item type returned in the result.
 */
export interface PaginateQueryOptions<TRow, TItem> {
	/**
	 * A Knex query builder configured with all filters applied.
	 * This is cloned internally for both the count query and the data query,
	 * so the original is not mutated.
	 */
	baseQuery: Knex.QueryBuilder;

	/**
	 * The column to count for the total (e.g., `'id'`, `'images.id'`).
	 */
	countColumn: string;

	/**
	 * A function that applies `.select(...)` and `.orderBy(...)` to the
	 * base query clone. The limit/offset are applied automatically after this.
	 */
	applySelect: (query: Knex.QueryBuilder) => Knex.QueryBuilder;

	/** Maximum number of items to return. */
	limit: number;

	/** Number of items to skip. */
	offset: number;

	/** Maps a raw database row to the result item type. */
	mapRow: (row: TRow) => TItem;
}

/**
 * Executes a paginated query pattern: counts total matching rows, then
 * fetches a page of results with limit/offset.
 *
 * Centralizes the count + paginate + return pattern used across list-pages,
 * list-images, and list-resources queries.
 * @param options - The pagination query options.
 * @returns The paginated result with items, total count, offset, and limit.
 */
export async function paginateQuery<TRow, TItem>(
	options: PaginateQueryOptions<TRow, TItem>,
): Promise<{
	items: TItem[];
	total: number;
	offset: number;
	limit: number;
}> {
	const { baseQuery, countColumn, applySelect, limit, offset, mapRow } = options;

	const countResult = (await baseQuery
		.clone()
		.clearSelect()
		.count(`${countColumn} as total`)) as { total: number }[];
	// SQL count() always returns exactly one row
	const total = Number(countResult[0]?.total ?? 0);

	const dataQuery = applySelect(baseQuery.clone());
	const rows: TRow[] = await dataQuery.limit(limit).offset(offset);
	const items = rows.map(mapRow);

	return { items, total, offset, limit };
}
