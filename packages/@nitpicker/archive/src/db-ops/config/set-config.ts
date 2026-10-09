import type { Config } from '../../types.js';
import type { Knex } from 'knex';

import { INFO_COLUMN_ALLOWLIST } from './info-column-allowlist.js';
import { INFO_JSON_COLUMNS } from './info-json-columns.js';

/**
 * Stores the crawl configuration in the `info` table.
 * Only fields in {@link ./info-column-allowlist.ts} are forwarded — any extra
 * runtime-only field on the input is silently dropped so callers can splat
 * a wider config object without producing SQL errors. JSON-array fields
 * are serialized via `JSON.stringify`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param config - The {@link Config} object to store.
 */
export async function setConfig(knex: Knex, config: Config) {
	const payload: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(config)) {
		if (!INFO_COLUMN_ALLOWLIST.has(key)) {
			continue;
		}
		payload[key] = INFO_JSON_COLUMNS.has(key) ? JSON.stringify(value) : value;
	}
	return knex.from<Config>('info').insert(payload);
}
