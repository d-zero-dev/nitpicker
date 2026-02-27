import type { Plugin } from './types.js';

/**
 * Standard analyze plugin module names bundled with the Nitpicker CLI.
 *
 * These are treated as built-in plugins and always available without
 * explicit configuration.
 */
const STANDARD_ANALYZE_PLUGINS = [
	'@nitpicker/analyze-axe',
	'@nitpicker/analyze-lighthouse',
	'@nitpicker/analyze-main-contents',
	'@nitpicker/analyze-markuplint',
	'@nitpicker/analyze-search',
	'@nitpicker/analyze-textlint',
] as const;

/**
 * Returns the standard set of `@nitpicker/analyze-*` plugins
 * as {@link Plugin} entries with default (empty) settings.
 *
 * This is used as a fallback when no configuration file is found,
 * allowing `nitpicker analyze` to work out of the box without
 * requiring a `.nitpickerrc` file.
 *
 * All analyze plugins are treated as standard packages bundled
 * with the CLI, so no filesystem scanning is necessary.
 * @returns Array of standard analyze plugins with empty settings.
 */
export function discoverAnalyzePlugins(): Plugin[] {
	return STANDARD_ANALYZE_PLUGINS.map((moduleName) => ({
		name: moduleName,
		module: moduleName,
		configFilePath: '',
		settings: {},
	}));
}
