import type { CommandDef, InferFlags } from '@d-zero/roar';

import { report as runReport } from '@nitpicker/report-google-sheets';

import { verbosely } from '../report/debug.js';

/**
 * Command definition for the `report` sub-command.
 * @see {@link report} for the main entry point
 */
export const commandDef = {
	desc: 'Generate a Google Sheets report',
	flags: {
		sheet: {
			shortFlag: 'S',
			type: 'string',
			isRequired: true,
			desc: 'Google Sheets URL',
		},
		credentials: {
			shortFlag: 'C',
			type: 'string',
			default: './credentials.json',
			desc: 'Path to credentials file (keep this file secure and out of version control)',
		},
		config: {
			shortFlag: 'c',
			type: 'string',
			desc: 'Path to config file',
		},
		limit: {
			shortFlag: 'l',
			type: 'number',
			default: 100_000,
			desc: 'Limit number of rows',
		},
		all: {
			type: 'boolean',
			desc: 'Generate all sheets without interactive prompt',
		},
		verbose: {
			type: 'boolean',
			desc: 'Output verbose log to standard out',
		},
		silent: {
			type: 'boolean',
			desc: 'No output log to standard out',
		},
	},
} as const satisfies CommandDef;

type ReportFlags = InferFlags<typeof commandDef.flags>;

/**
 * Main entry point for the `report` CLI command.
 *
 * Reads a `.nitpicker` archive and generates a Google Sheets report
 * by delegating to `@nitpicker/report-google-sheets`. Requires a Google
 * Sheets URL and a service account credentials file.
 *
 * When `--all` is specified, all sheets are generated without an interactive
 * prompt. In non-TTY environments (e.g. CI pipelines), `--all` is implied
 * automatically so the command never blocks on user input.
 * @param args - Positional arguments; first argument is the `.nitpicker` file path
 * @param flags - Parsed CLI flags from the `report` command
 */
export async function report(args: string[], flags: ReportFlags) {
	if (flags.verbose && !flags.silent) {
		verbosely();
	}

	const filePath = args[0];

	if (!filePath) {
		return;
	}

	const sheetUrl = flags.sheet;

	if (!sheetUrl) {
		return;
	}

	const credentialFilePath = flags.credentials;
	const configFilePath = flags.config || null;
	const limit = flags.limit;
	const isTTY = process.stdout.isTTY;
	const all = flags.all || !isTTY;

	await runReport({
		filePath,
		sheetUrl,
		credentialFilePath,
		configPath: configFilePath,
		limit,
		all,
		silent: flags.silent ?? false,
	});
}
