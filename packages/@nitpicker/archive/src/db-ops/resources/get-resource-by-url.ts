import type { DB_Resource } from '../../types.js';
import type { Knex } from 'knex';

import { buildResourceQuery } from './build-resource-query.js';
import { reconstructResourceRows } from './reconstruct-resource-rows.js';

/**
 * Retrieves a single sub-resource by its URL.
 *
 * Accepts multiple URL candidates because the stored key is the resource's
 * `href` while callers may only know the hash-stripped form; the first match
 * wins.
 * @param knex - Knex query builder connected to the archive DB.
 * @param urls - URL candidates to match against `url_refs.url`.
 * @returns The reconstructed {@link DB_Resource} row, or `null` if none match.
 */
export async function getResourceByUrl(
	knex: Knex,
	urls: readonly string[],
): Promise<DB_Resource | null> {
	const row = await buildResourceQuery(knex)
		.whereIn('ur.url', [...urls])
		.first();
	if (!row) {
		return null;
	}
	const [reconstructed] = await reconstructResourceRows(knex, [row]);
	return reconstructed ?? null;
}
