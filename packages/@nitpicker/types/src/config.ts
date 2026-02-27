/**
 * JSON configuration for Nitpicker loaded from `nitpicker.config.json` or
 * the `nitpicker` key in `package.json`.
 * @see {@link ../../core/src/load-plugin-settings.ts} for cosmiconfig resolution logic
 */
export interface ConfigJSON {
	/**
	 * Plugin configuration section.
	 */
	plugins?: {
		/**
		 * Map of analyze plugin package names to their settings.
		 * Keys are npm package names (e.g. `"@nitpicker/analyze-axe"`).
		 * A `true` value enables the plugin with default settings;
		 * an object value passes custom configuration to the plugin.
		 */
		analyze?: Record<string, PluginSetting | boolean>;
	};
}

/**
 * Arbitrary key-value settings passed to an analyze plugin.
 * Each plugin defines its own schema; this type serves as the
 * common transport shape between the config loader and the plugin runner.
 */
export type PluginSetting = Record<string, unknown>;
