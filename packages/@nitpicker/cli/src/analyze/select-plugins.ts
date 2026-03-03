import type { Plugin } from '@nitpicker/core';

/**
 * Parameters for {@link selectPlugins}.
 */
interface SelectPluginsParams {
	/** When `true`, all plugins are selected (no filtering). */
	readonly all: boolean;

	/** Explicit plugin name list from the `--plugin` flag. */
	readonly pluginFlags: readonly string[];

	/** Available plugin definitions from the archive config. */
	readonly plugins: readonly Plugin[];

	/** Whether the current environment is a TTY (interactive terminal). */
	readonly isTTY: boolean;

	/**
	 * Interactive prompt callback for TTY environments.
	 * Called only when no flags narrow the selection and the terminal is interactive.
	 * @returns Selected plugin names chosen by the user.
	 */
	readonly promptPlugins: () => Promise<string[]>;
}

/**
 * Determines which analyze plugins to run based on CLI flags and environment.
 *
 * Selection priority:
 * 1. `--all` flag → run all plugins (returns `undefined`)
 * 2. `--plugin` flag → filter to the specified plugin names
 * 3. Non-TTY environment → fall back to all plugins (returns `undefined`)
 * 4. TTY environment → delegate to the interactive prompt
 * @param params - Selection parameters including flags, plugins, and TTY state.
 * @returns An array of plugin names to filter by, or `undefined` to run all.
 */
export async function selectPlugins(
	params: SelectPluginsParams,
): Promise<string[] | undefined> {
	const { all, pluginFlags, plugins, isTTY, promptPlugins } = params;

	if (all) {
		return undefined;
	}

	if (pluginFlags.length > 0) {
		const availableNames = new Set(plugins.map((p) => p.name));
		return pluginFlags.filter((name) => availableNames.has(name));
	}

	if (!isTTY) {
		return undefined;
	}

	return promptPlugins();
}
