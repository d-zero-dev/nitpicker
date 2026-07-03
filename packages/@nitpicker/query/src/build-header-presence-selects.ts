import type { Knex } from 'knex';

import { HEADER_PRESENCE_KEYS, headerPresenceExpression } from './header-presence-sql.js';

/**
 * Builds the four SQL-computed header-presence columns (aliased to
 * `hasCSP` / `hasXFrameOptions` / `hasXContentTypeOptions` / `hasHSTS`) for
 * spreading into a `pages` query's `select`/`distinct` list. Computing these
 * in SQL — rather than selecting the raw `responseHeaders` blob and deriving
 * presence in JS — keeps the three "list pages" queries from transferring
 * and JSON-parsing a full response-headers blob per row just to discard it
 * after reading four booleans.
 * @param knex - Knex instance used to build the raw column expressions.
 * @returns Raw column expressions ready to spread into `select`/`distinct`.
 */
export function buildHeaderPresenceSelects(knex: Knex): Knex.Raw[] {
	return HEADER_PRESENCE_KEYS.map((key) =>
		knex.raw(`${headerPresenceExpression(key)} as "${key}"`),
	);
}
