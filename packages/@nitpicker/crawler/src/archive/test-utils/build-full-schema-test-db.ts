import type { Config } from '../types.js';
import type { Knex } from 'knex';

import knex from 'knex';

import { setConfig } from '../db-ops/config/set-config.js';
import { init } from '../db-ops/lifecycle/init.js';
import { LibsqlDialect } from '../libsql-dialect.js';

/**
 * Default {@link Config} fields for {@link buildFullSchemaTestDb} — a
 * single-root, recursive, non-list crawl of `https://example.com/`, no
 * excludes. Overridable per-call for scope/`fromList`/`disableQueries`
 * tests.
 */
const DEFAULT_TEST_CONFIG: Config = {
	version: '0.13.0',
	name: 'test',
	baseUrl: 'https://example.com/',
	roots: ['https://example.com/'],
	recursive: true,
	interval: 0,
	image: false,
	fetchExternal: false,
	parallels: 1,
	excludes: [],
	excludeKeywords: [],
	excludeUrls: [],
	maxExcludedDepth: 0,
	retry: 3,
	fromList: false,
	disableQueries: false,
	userAgent: 'test',
	ignoreRobots: false,
	mainContentSelector: null,
};

/**
 * Builds a file-backed knex connection against the FULL current archive
 * schema (every ref/entity/adjunct table, including columns only a
 * migration adds to a legacy archive — `alias_of_id`, `dedupe_cap_event_id`,
 * `body_hash`, …) by running the exact same {@link init} boot sequence a
 * real `Archive.create`/`Archive.open` uses. Shared by every
 * `archive/transfer/` spec that needs a realistic source or destination
 * database — hand-rolling `createRefTables`/`createEntityTables`/
 * `createAdjunctTables` directly would produce the schema `initSchema`
 * creates but skip the migrations that add columns for archives created
 * before those features existed (which happen to be a no-op on a fresh
 * DB today, but drift is exactly the risk this helper avoids).
 *
 * A DB file must be used (not `:memory:`) because `ATTACH DATABASE` in
 * the transfer primitives needs a real path — see `attach-source-database.ts`.
 * @param filename - Absolute path to the SQLite file. The caller is
 *   responsible for removing it (`afterEach`) — see existing specs for the
 *   convention.
 * @param config - Overrides merged over {@link DEFAULT_TEST_CONFIG} and
 *   written via `setConfig` once the schema exists. Pass `null` to skip
 *   writing an `info` row entirely (some specs seed `content_items`
 *   directly and never read `getConfig()`).
 * @returns The connected knex instance, on the current schema, with an
 *   `info` row unless `config` is `null`.
 * @example
 * ```ts
 * const db = await buildFullSchemaTestDb(path.resolve(workingDir, 'source.sqlite'), {
 *   roots: ['https://a.example.com/'],
 * });
 * ```
 */
export async function buildFullSchemaTestDb(
	filename: string,
	config: Partial<Config> | null = {},
): Promise<Knex> {
	const instance = knex({
		client: LibsqlDialect as never,
		connection: { filename },
		useNullAsDefault: true,
	});
	await init(instance, false);
	if (config !== null) {
		await setConfig(instance, { ...DEFAULT_TEST_CONFIG, ...config });
	}
	return instance;
}
