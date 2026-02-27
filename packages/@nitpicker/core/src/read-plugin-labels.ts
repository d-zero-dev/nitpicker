import type { Plugin } from './types.js';

/**
 * Reads the `label` property from each plugin by importing and
 * initializing the plugin module.
 *
 * Each plugin module's default export (a `PluginFactory`) is called
 * with the plugin's configured settings. The resulting `AnalyzePlugin`
 * object's `label` field is collected into a Map keyed by plugin name.
 *
 * Plugins that fail to import or initialize, or that lack a `label`,
 * are silently skipped.
 * @param plugins - Array of plugin definitions from the resolved config.
 * @returns Map from plugin name to its human-readable label.
 */
export async function readPluginLabels(
	plugins: readonly Plugin[],
): Promise<Map<string, string>> {
	const labels = new Map<string, string>();

	await Promise.all(
		plugins.map(async (plugin) => {
			try {
				const mod = await import(plugin.module);
				const factory = mod.default;
				const instance = await factory(plugin.settings ?? {}, plugin.configFilePath);
				if (instance && typeof instance.label === 'string') {
					labels.set(plugin.name, instance.label);
				}
			} catch {
				// Module not importable or factory failed — skip
			}
		}),
	);

	return labels;
}
