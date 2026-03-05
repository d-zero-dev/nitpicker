import type { CommandDef, InferFlags } from '@d-zero/roar';

import path from 'node:path';

import { Lanes } from '@d-zero/dealer';
import { Nitpicker, readPluginLabels } from '@nitpicker/core';
import enquirer from 'enquirer';

import { buildPluginOverrides } from '../analyze/build-plugin-overrides.js';
import { verbosely } from '../analyze/debug.js';
import { log } from '../analyze/log.js';
import { selectPlugins } from '../analyze/select-plugins.js';
import { formatCliError } from '../format-cli-error.js';

/** Enquirer prompt function for interactive CLI dialogs. */
const { prompt } = enquirer;

/**
 * Command definition for the `analyze` sub-command.
 * @see {@link analyze} for the main entry point
 */
export const commandDef = {
	desc: 'Analyze a .nitpicker archive',
	flags: {
		all: {
			type: 'boolean',
			desc: 'Run all analysis plugins',
		},
		plugin: {
			type: 'string',
			isMultiple: true,
			desc: 'Specify plugins to run (e.g. --plugin @nitpicker/analyze-axe --plugin @nitpicker/analyze-textlint)',
		},
		verbose: {
			type: 'boolean',
			desc: 'Output logs verbosely',
		},
		searchKeywords: {
			type: 'string',
			isMultiple: true,
			desc: 'Keywords for analyze-search plugin (overrides config file)',
		},
		searchScope: {
			type: 'string',
			desc: 'CSS selector to narrow search scope for analyze-search plugin (overrides config file)',
		},
		mainContentSelector: {
			type: 'string',
			desc: 'CSS selector for main content detection in analyze-main-contents plugin (overrides config file)',
		},
		axeLang: {
			type: 'string',
			desc: 'BCP 47 language tag for analyze-axe plugin (overrides config file)',
		},
		silent: {
			type: 'boolean',
			desc: 'No output log to standard out',
		},
	},
} as const satisfies CommandDef;

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
		console.error('Usage: nitpicker analyze <file> [options]');
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
		if (!silent) {
			// eslint-disable-next-line no-console
			console.log(`  📦 Extracting archive: ${absFilePath}`);
		}
		const nitpicker = await Nitpicker.open(absFilePath);

		const pluginOverrides = buildPluginOverrides(flags);
		if (Object.keys(pluginOverrides).length > 0) {
			nitpicker.setPluginOverrides(pluginOverrides);
		}

		const config = await nitpicker.getConfig();
		const plugins = config.analyze || [];

		if (plugins.length === 0) {
			throw new Error(
				'No analyze plugins found. Install @nitpicker/analyze-* packages or configure them in .nitpickerrc.',
			);
		}

		const pluginFlags = flags.plugin ?? [];

		const filter = await selectPlugins({
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
			if (filter.length === 0) {
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

		const lanes = silent ? undefined : new Lanes({ verbose, indent: '  ' });
		try {
			await nitpicker.analyze(filter, { lanes, verbose });
		} finally {
			lanes?.close();
		}

		await nitpicker.write();
		await nitpicker.archive.close();
	} catch (error) {
		formatCliError(error, verbose);
		process.exit(1);
	}
}
