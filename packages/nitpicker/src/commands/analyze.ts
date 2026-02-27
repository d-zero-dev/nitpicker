import type { CommandDef, InferFlags } from '@d-zero/roar';

import path from 'node:path';

import { Lanes } from '@d-zero/dealer';
import { Nitpicker, readPluginLabels } from '@nitpicker/core';
import enquirer from 'enquirer';

import { log } from '../analyze/log.js';

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
		verbose: {
			type: 'boolean',
			desc: 'Output logs verbosely',
		},
	},
} as const satisfies CommandDef;

type AnalyzeFlags = InferFlags<typeof commandDef.flags>;

/**
 * Main entry point for the `analyze` CLI command.
 *
 * Opens a `.nitpicker` archive, loads the configured analyze plugins,
 * presents an interactive multi-select prompt (unless `--all` is specified),
 * runs the selected plugins with per-plugin Lanes progress display, and
 * writes results back to the archive.
 *
 * WHY enquirer prompt: Allows users to selectively run expensive plugins
 * (e.g. Lighthouse) without re-running everything. The `--all` flag
 * bypasses the prompt for CI/automation use cases.
 * @param args - Positional arguments; first argument is the `.nitpicker` file path
 * @param flags - Parsed CLI flags from the `analyze` command
 */
export async function analyze(args: string[], flags: AnalyzeFlags) {
	const filePath = args[0];

	if (!filePath) {
		return;
	}

	const isTTY = process.stdout.isTTY;

	const absFilePath = path.isAbsolute(filePath)
		? filePath
		: path.resolve(process.cwd(), filePath);
	// eslint-disable-next-line no-console
	console.log(`  📦 Extracting archive: ${absFilePath}`);
	const nitpicker = await Nitpicker.open(absFilePath);

	const config = await nitpicker.getConfig();
	const plugins = config.analyze || [];
	const pluginNameList = plugins.map((plugin) => plugin.name);

	if (pluginNameList.length === 0) {
		// eslint-disable-next-line no-console
		console.error(
			'No analyze plugins found. Install @nitpicker/analyze-* packages or configure them in .nitpickerrc.',
		);
		return;
	}

	let filter: string[] | undefined;

	if (!flags.all) {
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
		filter = res.filter;
	}

	const siteUrl = (await nitpicker.archive.getUrl()) || '<Unknown URL>';

	log(nitpicker, [`🥢 ${siteUrl} (${filePath})`, `  📤 Read file: ${absFilePath}`]);

	const lanes = new Lanes({ verbose: !isTTY, indent: '  ' });
	try {
		await nitpicker.analyze(filter, { lanes, verbose: !isTTY });
	} finally {
		lanes.close();
	}

	await nitpicker.write();
	await nitpicker.archive.close();
}
