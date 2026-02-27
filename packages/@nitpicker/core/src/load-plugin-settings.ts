import type { Config, Plugin } from './types.js';
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
 */
export async function loadPluginSettings(
	defaultConfig: Partial<Config> = {},
): Promise<Config> {
	const explorer = cosmiconfig(MODULE_NAME);
	const result = await explorer.search();
	if (!result) {
		const defaultPlugins = defaultConfig.analyze || [];
		return {
			analyze: defaultPlugins.length > 0 ? defaultPlugins : discoverAnalyzePlugins(),
		};
	}
	const config = result.config as ConfigJSON;
	const { isEmpty, filepath } = result;
	if (!config || isEmpty) {
		const defaultPlugins = defaultConfig.analyze || [];
		return {
			analyze: defaultPlugins.length > 0 ? defaultPlugins : discoverAnalyzePlugins(),
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

	return {
		analyze: mergedPlugins.length > 0 ? mergedPlugins : discoverAnalyzePlugins(),
	};
}
