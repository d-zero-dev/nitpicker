import type { AnalyzePlugin, Plugin } from './types.js';

/**
 * Allowed prefix for analyze plugin module names.
 * Only modules starting with this prefix are permitted to be dynamically imported.
 */
const ALLOWED_PREFIX = '@nitpicker/analyze-';

/**
 * Dynamically imports and initializes all analyze plugin modules.
 *
 * For each plugin in the list:
 * 1. Validates that `plugin.module` starts with `@nitpicker/analyze-`
 * 2. Calls `import(plugin.module)` to load the npm package
 * 3. Invokes the module's default export (a `PluginFactory` factory)
 *    with the plugin's `settings`
 * 4. Returns the resulting `AnalyzePlugin` instance
 *
 * All plugins are loaded in parallel via `Promise.all` for performance.
 *
 * This function is called both in the main thread (for `headers` and `eachUrl`)
 * and inside each Worker thread (for `eachPage`). The Worker-side call is
 * necessary because plugin modules may not be transferable across threads.
 * @param plugins - Array of plugin definitions from the resolved config.
 * @returns Array of initialized `AnalyzePlugin` instances, in the same order.
 * @throws {Error} If any plugin module name does not start with `@nitpicker/analyze-`.
 * @see {@link ./types.ts} for the `PluginFactory` factory function signature
 * @see {@link ./page-analysis-worker.ts} for Worker-side usage
 * @see {@link ./nitpicker.ts!Nitpicker.analyze} for main-thread usage
 */
export async function importModules(plugins: Plugin[]) {
	const analyzeMods = await Promise.all(
		plugins.map(async (plugin) => {
			if (!plugin.module.startsWith(ALLOWED_PREFIX)) {
				throw new Error(
					`Unauthorized plugin module: "${plugin.module}". Plugin modules must start with "${ALLOWED_PREFIX}".`,
				);
			}
			const mod = await import(plugin.module);
			const factory = mod.default;
			return factory(plugin.settings) as AnalyzePlugin;
		}),
	);
	return analyzeMods;
}
