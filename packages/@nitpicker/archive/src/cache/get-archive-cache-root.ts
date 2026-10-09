import os from 'node:os';
import path from 'node:path';

/**
 * Env values that look like a "disable" sentinel rather than a path.
 *
 * A user who copy-pastes the `NITPICKER_DISABLE_TAR_CACHE` convention
 * onto `NITPICKER_TAR_CACHE_DIR` (e.g. `NITPICKER_TAR_CACHE_DIR=0`
 * thinking it means "use default") would otherwise silently land the
 * cache at `$PWD/0/` — multi-gigabyte extracts polluting the project
 * tree, never reclaimed by OS temp cleanup. Reject these explicitly
 * and fall back to the default location instead.
 */
const SENTINEL_LIKE_OVERRIDES = new Set([
	'0',
	'1',
	'false',
	'true',
	'no',
	'yes',
	'off',
	'on',
	'null',
	'undefined',
]);

/**
 * Resolve the directory where extracted `.nitpicker` archives are cached.
 *
 * Resolution order:
 *
 * 1. `NITPICKER_TAR_CACHE_DIR` env — explicit override (CI, testing, or
 *    operators who want the cache on a specific volume). Must be a
 *    path; values that look like boolean / sentinel words (e.g. `0`,
 *    `false`) are ignored to keep the cache from landing somewhere
 *    surprising when the user mistakes the env contract.
 * 2. `<os.tmpdir()>/nitpicker/cache/` — default. Lives under the OS
 *    temp directory so the platform's own cleanup (macOS reboot, Linux
 *    `systemd-tmpfiles`, Windows Disk Cleanup) reclaims stale entries
 *    without bespoke logic on our side.
 *
 * The returned path is absolute. The caller is responsible for creating
 * it on demand (this function is pure).
 * @returns Absolute path to the cache root directory.
 */
export function getArchiveCacheRoot(): string {
	const envOverride = process.env.NITPICKER_TAR_CACHE_DIR;
	if (envOverride && envOverride.trim().length > 0) {
		const trimmed = envOverride.trim();
		if (!SENTINEL_LIKE_OVERRIDES.has(trimmed.toLowerCase())) {
			return path.resolve(trimmed);
		}
	}
	return path.resolve(os.tmpdir(), 'nitpicker', 'cache');
}
