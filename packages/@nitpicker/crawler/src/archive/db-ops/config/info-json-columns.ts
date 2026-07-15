import type { Config } from '../../types.js';

/**
 * Subset of {@link ./info-column-allowlist.ts} that is stored as a JSON-encoded
 * string and therefore needs `JSON.stringify` on write.
 */
export const INFO_JSON_COLUMNS: ReadonlySet<string> = new Set<keyof Config>([
	'roots',
	'excludes',
	'excludeKeywords',
	'excludeUrls',
]);
