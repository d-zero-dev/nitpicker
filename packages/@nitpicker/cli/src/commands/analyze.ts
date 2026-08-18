import type { commandDef } from './analyze-def.js';
import type { InferFlags } from '@d-zero/roar';

import path from 'node:path';

import { Lanes } from '@d-zero/dealer';
import { Nitpicker, readPluginLabels } from '@nitpicker/core';
import enquirer from 'enquirer';

import { buildPluginOverrides } from '../analyze/build-plugin-overrides.js';
import { verbosely } from '../analyze/debug.js';
import { log } from '../analyze/log.js';
import { selectPlugins } from '../analyze/select-plugins.js';
import { createByteProgressLogger } from '../create-byte-progress-logger.js';
import { formatCliError } from '../format-cli-error.js';
import { formatLogLine } from '../format-log-line.js';

/** Enquirer prompt function for interactive CLI dialogs. */
const { prompt } = enquirer;

/** Parsed flag values for the `analyze` CLI command. */
type AnalyzeFlags = InferFlags<typeof commandDef.flags>;

/**
 * Main entry point for the `analyze` CLI command.
 *
 * Opens a `.nitpicker` archive, loads the configured analyze plugins,
 * presents an interactive multi-select prompt (unless `--all` or `--plugin`
 * is specified), runs the selected plugins with per-plugin Lanes progress
 * display, and writes results back to the archive.
 *
 * WHY enquirer prompt: Allows users to selectively run expensive plugins
 * (e.g. Lighthouse) without re-running everything. The `--all` flag
 * bypasses the prompt for CI/automation use cases. The `--plugin` flag
 * allows specifying individual plugins without interaction.
 *
 * In non-TTY environments (e.g. CI pipelines), `--verbose` is implied
 * automatically so error details are always available in CI logs.
 * When `--silent` is set, all log output and Lanes progress display are
 * suppressed. `--silent` takes precedence over `--verbose`.
 * @param args - Positional arguments; first argument is the `.nitpicker` file path.
 * @param flags - Parsed CLI flags from the `analyze` command.
 * @returns Resolves when analysis and archive write are complete.
 *   Exits with code 1 if no file path is provided, no plugins are found, or an error occurs.
 */
export async function analyze(args: string[], flags: AnalyzeFlags) {
	const filePath = args[0];

	if (!filePath) {
		// eslint-disable-next-line no-console
		console.error('Error: No .nitpicker file specified.');
		// eslint-disable-next-line no-console
		console.error('Usage: npx @nitpicker/cli analyze <file> [options]');
		process.exit(1);
	}

	const isTTY = process.stdout.isTTY;
	const silent = !!flags.silent;
	const verbose = !silent && (flags.verbose || !isTTY);

	if (flags.verbose && !silent) {
		verbosely();
	}

	try {
		const absFilePath = path.isAbsolute(filePath)
			? filePath
			: path.resolve(process.cwd(), filePath);
		// `extractLanes` is scoped to this block, not the whole `try` (issue
		// #294): a large archive's extraction can take tens of seconds and
		// previously printed one static line with no progress; the plugin-run
		// phase below prints its own plain `console.log` lines via `log()`,
		// which would corrupt this Lanes' cursor-based redraw if both were
		// alive at once.
		let openedNitpicker: Nitpicker;
		{
			using extractLanes = silent ? null : new Lanes({ verbose, indent: '  ' });
			const logExtract = (message: string) => {
				extractLanes?.update(0, formatLogLine(verbose, message));
			};
			logExtract('%braille% Extracting archive%dots%');
			openedNitpicker = await Nitpicker.open(
				absFilePath,
				silent ? undefined : createByteProgressLogger(logExtract, 'Extracting archive'),
			);
		}
		await using nitpicker = openedNitpicker;

		const pluginOverrides = buildPluginOverrides(flags);
		if (Object.keys(pluginOverrides).length > 0) {
			nitpicker.setPluginOverrides(pluginOverrides);
		}

		const config = await nitpicker.getConfig();
		const plugins = config.analyze || [];

		// `--templates` runs an opt-in core phase independent of the
		// `@nitpicker/analyze-*` plugin system (see `AnalyzeOptions.classifyTemplates`),
		// so a plugin-less config is only an error when templates aren't requested.
		if (plugins.length === 0 && !flags.templates) {
			throw new Error(
				'No analyze plugins found. Install @nitpicker/analyze-* packages or configure them in .nitpickerrc.',
			);
		}

		const pluginFlags = flags.plugin ?? [];

		const filter =
			plugins.length === 0
				? []
				: await selectPlugins({
						all: flags.all ?? false,
						pluginFlags,
						plugins,
						isTTY: !!isTTY,
						async promptPlugins() {
							const labels = await readPluginLabels(plugins);
							const choices = plugins.map((plugin) => ({
								name: plugin.name,
								message: labels.get(plugin.name) || plugin.name,
							}));
							const res = await prompt<{ filter: string[] }>([
								{
									message: 'What do you analyze?',
									name: 'filter',
									type: 'multiselect',
									choices,
								},
							]);
							return res.filter;
						},
					});

		// Warn about unknown plugin names specified via --plugin
		if (pluginFlags.length > 0 && filter) {
			const matched = new Set(filter);
			const unknownPlugins = pluginFlags.filter((name) => !matched.has(name));
			if (unknownPlugins.length > 0) {
				const availableNames = plugins.map((p) => p.name).join(', ');
				// eslint-disable-next-line no-console
				console.error(
					`Unknown plugin(s): ${unknownPlugins.join(', ')}\nAvailable plugins: ${availableNames}`,
				);
			}
			// Same `--templates` bypass as the plugin-less guard above: an
			// entirely-unmatched `--plugin` list is only a hard error when
			// there's no other reason (template classification) for this
			// run to proceed.
			if (filter.length === 0 && !flags.templates) {
				throw new Error('No valid plugins to run.');
			}
		}

		const siteUrl = (await nitpicker.archive.getUrl()) || '<Unknown URL>';

		if (!silent) {
			log(
				nitpicker,
				[`🥢 ${siteUrl} (${filePath})`, `  📤 Read file: ${absFilePath}`],
				verbose,
			);
		}

		{
			using lanes = silent ? undefined : new Lanes({ verbose, indent: '  ' });
			await nitpicker.analyze(filter, {
				lanes,
				verbose,
				classifyTemplates: flags.templates,
			});
		}

		await nitpicker.write();
	} catch (error) {
		formatCliError(error, verbose);
		process.exit(1);
	}
}
