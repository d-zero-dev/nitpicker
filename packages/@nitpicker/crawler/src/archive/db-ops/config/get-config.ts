import type { Config } from '../../types.js';
import type { Knex } from 'knex';

import { dbLog } from '../../debug.js';
import { getJSON } from '../../get-json.js';

/**
 * Retrieves the full crawl configuration from the `info` table.
 * Deserializes JSON-encoded fields (`roots`, `excludes`, `excludeKeywords`, `excludeUrls`).
 * @param knex - Knex query builder connected to the archive DB.
 * @returns The parsed {@link Config} object.
 * @throws {Error} If no configuration is found in the database.
 */
export async function getConfig(knex: Knex): Promise<Config> {
	const [config] = await knex.select('*').from<Config>('info');
	if (!config) {
		throw new Error('No config');
	}
	const opt: Config = {
		...config,
		excludes: getJSON<string[]>(config.excludes, []),
		excludeKeywords: getJSON<string[]>(config.excludeKeywords, []),
		excludeUrls: getJSON<string[]>(config.excludeUrls, []),
		roots: getJSON<string[]>(config.roots, []),
		retry: config.retry ?? 3,
	};
	// @ts-expect-error — `id` is the primary key, not part of the public Config shape
	delete opt.id;
	dbLog('Table `info`: %O => %O', config, opt);
	return opt;
}
