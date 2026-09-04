import type { Config } from '../../types.js';

/**
 * Columns of the `info` table that `setConfig` / `updateConfig` are allowed to
 * write. Any key outside this set is silently dropped so callers can splat a
 * wider runtime config (with extras like `cwd`) without hitting "no such
 * column" at the SQL layer.
 */
export const INFO_COLUMN_ALLOWLIST: ReadonlySet<string> = new Set<keyof Config>([
	'version',
	'name',
	'baseUrl',
	'roots',
	'recursive',
	'interval',
	'image',
	'fetchExternal',
	'parallels',
	'excludes',
	'excludeKeywords',
	'excludeUrls',
	'maxExcludedDepth',
	'retry',
	'fromList',
	'disableQueries',
	'userAgent',
	'ignoreRobots',
	'mainContentSelector',
	'createdCwd',
]);
