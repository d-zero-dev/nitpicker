/**
 * Whether the tar cache is disabled by the `NITPICKER_DISABLE_TAR_CACHE`
 * env var.
 *
 * Useful for two scenarios:
 *
 * 1. Debugging — bypass the cache to reproduce the cold-start behaviour
 *    against a fresh tmpDir.
 * 2. Sandboxed CI — when the runner's tmpfs would not survive between
 *    steps anyway, the cache only adds first-step overhead.
 *
 * Accepted truthy values: `1`, `true`, `yes`, `on` (case-insensitive).
 * Anything else (including unset) keeps the cache enabled.
 * @returns `true` when the cache should be bypassed.
 * @example
 * ```ts
 * if (isArchiveCacheDisabled()) {
 *   // Fall back to the writer path; cwd tmpDir + close-time cleanup.
 *   const archive = await Archive.open({ filePath });
 *   ...
 * }
 * ```
 */
export function isArchiveCacheDisabled(): boolean {
	const raw = process.env.NITPICKER_DISABLE_TAR_CACHE;
	if (!raw) {
		return false;
	}
	const normalized = raw.trim().toLowerCase();
	return (
		normalized === '1' ||
		normalized === 'true' ||
		normalized === 'yes' ||
		normalized === 'on'
	);
}
