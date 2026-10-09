import type { Config } from '../../types.js';
import type { Knex } from 'knex';

import { INFO_COLUMN_ALLOWLIST } from './info-column-allowlist.js';
import { INFO_JSON_COLUMNS } from './info-json-columns.js';

/**
 * Update the single row in the `info` table with a partial config patch.
 *
 * Used by the append flow to extend `roots` (and any other tweakable
 * field) without replacing the entire row. JSON-array fields are serialized on
 * the fly; primitive fields are written verbatim. Unspecified fields stay as-is.
 *
 * Unknown keys (anything outside the allow-list of `info`-table columns) are
 * silently dropped instead of being passed to SQL, so callers that splat a
 * wider runtime config (e.g. `CrawlConfig` with `cwd` / `executablePath`)
 * cannot accidentally trigger a "no such column" SQL error.
 * @param knex - Knex query builder connected to the archive DB.
 * @param patch - Partial {@link Config} fields to overwrite. `undefined` values are skipped.
 */
export async function updateConfig(knex: Knex, patch: Partial<Config>): Promise<void> {
	const payload: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) {
			continue;
		}
		if (!INFO_COLUMN_ALLOWLIST.has(key)) {
			continue;
		}
		if (INFO_JSON_COLUMNS.has(key)) {
			payload[key] = JSON.stringify(value);
			continue;
		}
		payload[key] = value;
	}
	if (Object.keys(payload).length === 0) {
		return;
	}
	await knex.from<Config>('info').update(payload);
}
