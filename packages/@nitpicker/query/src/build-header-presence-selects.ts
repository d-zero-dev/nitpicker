import type { Knex } from 'knex';

import { HEADER_PRESENCE_KEYS, headerPresenceExpression } from './header-presence-sql.js';

/**
 * Default table alias used for `header_flags` in 0.13 queries. Chosen
 * short so raw SQL expressions stay readable.
 */
export const DEFAULT_HEADER_FLAGS_ALIAS = 'hf';

/**
 * Builds the four SQL-computed header-presence columns (aliased to
 * `hasCSP` / `hasXFrameOptions` / `hasXContentTypeOptions` / `hasHSTS`) for
 * spreading into a query's `select`/`distinct` list. The caller MUST have
 * already joined `header_flags` under `flagsAlias`.
 * @param knex - Knex instance used to build the raw column expressions.
 * @param flagsAlias - table alias under which `header_flags` was joined.
 * @returns Raw column expressions ready to spread into `select`/`distinct`.
 */
export function buildHeaderPresenceSelects(
	knex: Knex,
	flagsAlias: string = DEFAULT_HEADER_FLAGS_ALIAS,
): Knex.Raw[] {
	return HEADER_PRESENCE_KEYS.map((key) =>
		knex.raw(`${headerPresenceExpression(key, flagsAlias)} as "${key}"`),
	);
}
