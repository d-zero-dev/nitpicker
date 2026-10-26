/**
 * The commands that run native calls on the addon's thread pool: the crawl's
 * post-processing (also inside `pipeline`), the read model build behind
 * `viewer` / `viewer-build`, `query`'s snapshot scans and URL ranking, and the
 * template classification of `concat` / `split`. `report` and `cache` never
 * reach it.
 *
 * An allow-list rather than "everything but `cache`": a command that does not
 * use the pool should not pay for loading the addon, nor fail on a platform it
 * is not built for. A command added later that reaches the pool must be added
 * here.
 */
const COMMANDS_USING_NATIVE_POOL: ReadonlySet<string> = new Set([
	'crawl',
	'pipeline',
	'query',
	'viewer',
	'viewer-build',
	'concat',
	'split',
]);

/**
 * Whether a CLI command runs native calls on the addon's thread pool, so its
 * `NITPICKER_NATIVE_*` settings are checked before it starts.
 * @param command - The command name as parsed (`undefined` when none was given).
 * @returns `true` for the commands that use the pool.
 * @example
 * ```ts
 * commandUsesNativePool('query'); // true
 * commandUsesNativePool('report'); // false
 * ```
 */
export function commandUsesNativePool(command: string | undefined): boolean {
	return command !== undefined && COMMANDS_USING_NATIVE_POOL.has(command);
}
