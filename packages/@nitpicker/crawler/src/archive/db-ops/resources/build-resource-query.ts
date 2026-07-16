import type { Knex } from 'knex';

/**
 * Builds a `resource_items` query joined against `url_refs` and
 * `content_type_refs`, reconstructing a flat, legacy-shaped resource row.
 * Selected columns are aliased to `DB_Resource` field names. `responseHeaders`
 * is NOT reconstructed here (it needs a second, batched pass — see
 * {@link ../resources/reconstruct-resource-rows.js}) so this query stays a
 * single-pass join with no N+1 subqueries; `headerSetId` is selected as an
 * intermediate for that second pass.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns A query builder pre-configured with the joins `get-resources.ts` /
 *   `get-resource-by-url.ts` need; callers add `.where()` on top.
 * @example
 * const rows = await buildResourceQuery(knex).whereIn('ur.url', urls);
 */
export function buildResourceQuery(knex: Knex): Knex.QueryBuilder {
	return knex('resource_items as ri')
		.join('url_refs as ur', 'ur.id', 'ri.url_id')
		.leftJoin('content_type_refs as ctr', 'ctr.id', 'ri.content_type_id')
		.select(
			'ri.id as id',
			'ur.url as url',
			'ri.is_external as isExternal',
			'ri.status as status',
			'ri.status_text as statusText',
			'ctr.raw as contentType',
			'ri.content_length as contentLength',
			'ri.header_set_id as headerSetId',
			'ri.compress as compress',
			'ri.cdn as cdn',
			'ri.source as source',
		);
}
