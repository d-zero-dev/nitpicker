import { checkNativeExecutorConfig as checkNativeExecutorConfigNatively } from '@nitpicker/core/check-native-executor-config';

/**
 * Checks the native thread pool's environment settings
 * (`NITPICKER_NATIVE_THREADS`, `NITPICKER_NATIVE_CONCURRENCY`) before any work
 * starts. The settings, their defaults and when they are read are documented
 * on `@nitpicker/core`'s `checkNativeExecutorConfig`.
 *
 * Why here and not a direct import of core: the CLI and the MCP server reach
 * the addon only through this package (as `query` does for the snapshot
 * scans), so the dependency direction stays `archive ← cli / mcp-server`.
 * @throws {Error} With code `InvalidArg`, naming the variable and its value,
 *   when a setting is not a positive integer.
 * @example
 * ```ts
 * checkNativeExecutorConfig(); // throws before the server starts if the env is wrong
 * ```
 */
export function checkNativeExecutorConfig(): void {
	checkNativeExecutorConfigNatively();
}
