import type { Config, Plugin, PluginOverrides } from './types.js';
import type { ConfigJSON } from '@nitpicker/types';

import { cosmiconfig } from 'cosmiconfig';

import { discoverAnalyzePlugins } from './discover-analyze-plugins.js';

/**
 * The cosmiconfig module name used for config file discovery.
 * Searches for: `.nitpickerrc`, `.nitpickerrc.json`, `.nitpickerrc.yaml`,
 * `nitpicker.config.js`, `nitpicker.config.cjs`, or a `"nitpicker"` key
 * in `package.json`.
 */
const MODULE_NAME = 'nitpicker';

/**
 * Loads the analyze plugin configuration from the user's config file.
 *
 * Uses cosmiconfig to search the filesystem from `process.cwd()` upward
 * for a Nitpicker configuration file. The external config format
 * (`ConfigJSON` from `@nitpicker/types`) is normalized into the internal
 * {@link Config} model:
 *
 * - `config.plugins.analyze` (object keyed by module name with settings)
 *   is converted to an ordered `Plugin[]` array
 * - Boolean `true` settings are normalized to empty objects `{}`
 * - The config file path is attached to each plugin for relative path resolution
 * @param defaultConfig - Optional partial config to merge as defaults.
 *   Plugin lists are concatenated (defaults first, then discovered plugins).
 * @param pluginOverrides
 * @returns Fully resolved {@link Config} with the `analyze` plugin list.
 * @example
 * ```ts
 * // .nitpickerrc.json
 * // {
 * //   "plugins": {
 * //     "analyze": {
 * //       "@nitpicker/analyze-axe": { "lang": "ja" },
 * //       "@nitpicker/analyze-markuplint": true
 * //     }
 * //   }
 * // }
 *
 * const config = await loadPluginSettings();
 * // config.analyze = [
 * //   { name: '@nitpicker/analyze-axe', module: '@nitpicker/analyze-axe',
 * //     configFilePath: '/path/to/.nitpickerrc.json', settings: { lang: 'ja' } },
 * //   { name: '@nitpicker/analyze-markuplint', module: '@nitpicker/analyze-markuplint',
 * //     configFilePath: '/path/to/.nitpickerrc.json', settings: {} },
 * // ]
 * ```
 * @see {@link ./types.ts!Config} for the output type
 * @see {@link ./types.ts!Plugin} for individual plugin entries
 * @see {@link ./types.ts!PluginOverrides} for CLI override support
 */
export async function loadPluginSettings(
	defaultConfig: Partial<Config> = {},
	pluginOverrides: PluginOverrides = {},
): Promise<Config> {
	const explorer = cosmiconfig(MODULE_NAME);
	const result = await explorer.search();
	if (!result) {
		const defaultPlugins = defaultConfig.analyze || [];
		const plugins = defaultPlugins.length > 0 ? defaultPlugins : discoverAnalyzePlugins();
		return {
			analyze: applyPluginOverrides(plugins, pluginOverrides),
		};
	}
	const config = result.config as ConfigJSON;
	const { isEmpty, filepath } = result;
	if (!config || isEmpty) {
		const defaultPlugins = defaultConfig.analyze || [];
		const plugins = defaultPlugins.length > 0 ? defaultPlugins : discoverAnalyzePlugins();
		return {
			analyze: applyPluginOverrides(plugins, pluginOverrides),
		};
	}

	const analyzePlugins: Plugin[] = [];

	if (config.plugins && config.plugins.analyze) {
		const moduleNames = Object.keys(config.plugins.analyze);

		for (const name of moduleNames) {
			if (!config.plugins.analyze[name]) {
				continue;
			}
			const settings =
				config.plugins.analyze[name] === true ? {} : config.plugins.analyze[name];
			analyzePlugins.push({
				name,
				module: name,
				configFilePath: filepath,
				settings,
			});
		}
	}

	const mergedPlugins = [...(defaultConfig.analyze || []), ...analyzePlugins];

	const finalPlugins =
		mergedPlugins.length > 0 ? mergedPlugins : discoverAnalyzePlugins();

	return {
		analyze: applyPluginOverrides(finalPlugins, pluginOverrides),
	};
}

/**
 * Applies CLI-specified overrides to plugin settings.
 *
 * For each plugin in the list, if there is a matching entry in
 * `overrides`, the override values are shallow-merged into the
 * plugin's existing settings. CLI values take precedence over
 * config-file values.
 * @param plugins - The plugin list to apply overrides to.
 * @param overrides - CLI-specified plugin setting overrides.
 * @returns A new plugin array with overrides applied.
 */
function applyPluginOverrides(plugins: Plugin[], overrides: PluginOverrides): Plugin[] {
	const overrideKeys = Object.keys(overrides) as (keyof PluginOverrides)[];
	if (overrideKeys.length === 0) {
		return plugins;
	}

	return plugins.map((plugin) => {
		const override = overrides[plugin.module as keyof PluginOverrides];
		if (!override) {
			return plugin;
		}
		return {
			...plugin,
			settings: {
				...(plugin.settings as Record<string, unknown> | undefined),
				...override,
			},
		};
	});
}
