import type { Knex } from 'knex';

/**
 * The query over `resource_ref_edges` that both referrer lookups
 * (`getResourceReferrerEdges`, which also selects each page's URL, and
 * `getResourceReferrerPageEdges`, which selects ids only) run for one chunk of
 * resources. The caller adds its own `select`.
 *
 * It lives in one place so the two lookups cannot disagree on which edges
 * exist: the inner joins to `content_items` and `url_refs` drop an edge whose
 * page has no such row, and that rule must be the same whether or not the URL
 * is read. `referrer_count` (counted from ids) and the report's referrer list
 * (read with URLs) are compared against each other.
 * @param knex - A Knex instance or open transaction.
 * @param resourceIds - `resource_items.id` values of one chunk. The caller
 *   keeps the chunk within SQLite's bound-parameter limit (`SQLITE_IN_CHUNK`).
 * @returns The query builder, without a `select`.
 * @example
 * const rows = await buildResourceReferrerEdgeQuery(knex, chunk).select(
 *   'rre.resource_id as resourceId',
 *   'rre.page_id as pageId',
 * );
 */
export function buildResourceReferrerEdgeQuery(
	knex: Knex,
	resourceIds: readonly number[],
): Knex.QueryBuilder {
	return knex('resource_ref_edges as rre')
		.join('content_items as ci', 'ci.id', 'rre.page_id')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.whereIn('rre.resource_id', [...resourceIds]);
}
