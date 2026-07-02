import type { Knex } from 'knex';

import { orderByUrlRank } from './url-sort-temp-table.js';

/**
 * Centralizes list ordering so every viewer table rejects unknown sort keys the
 * same way and URL columns always route through the session-local natural sort
 * ranks instead of ad hoc lexical SQL order.
 * @param query - Query to mutate.
 * @param knex - Knex instance.
 * @param sortBy - Requested sort field.
 * @param sortOrder - Requested direction.
 * @param columns - Field-to-SQL-column map. URL columns use TEMP rank.
 * @returns The query.
 * @example
 * applyListOrder(query, knex, 'url', 'asc', {
 *   url: { column: '"pages"."url"', type: 'url' },
 *   status: { column: '"pages"."status"' },
 * });
 */
export function applyListOrder<TSortBy extends string>(
	query: Knex.QueryBuilder,
	knex: Knex,
	sortBy: string,
	sortOrder: 'asc' | 'desc' | undefined,
	columns: Record<TSortBy, { column: string; type?: 'url' | 'plain' }>,
): Knex.QueryBuilder {
	const order = sortOrder === 'desc' ? 'desc' : 'asc';
	const config = columns[sortBy as TSortBy] ?? Object.values(columns)[0];
	if (!config) return query;
	if (config.type === 'url') {
		return orderByUrlRank(query, knex, config.column, order);
	}
	return query.orderByRaw(`${config.column} ${order}`);
}
