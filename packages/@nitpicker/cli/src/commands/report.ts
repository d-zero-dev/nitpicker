import type { CommandDef, InferFlags } from '@d-zero/roar';

import path from 'node:path';

import {
	report as runReport,
	reportLocal as runReportLocal,
} from '@nitpicker/report-google-sheets';

import { formatCliError } from '../format-cli-error.js';
import { verbosely } from '../report/debug.js';

/**
 * Default directory for TSV output: `<archive-stem>-report` under the current working directory.
 * @param nitpickerFilePath - Path to the `.nitpicker` archive.
 * @returns Absolute path to the output folder.
 */
function defaultLocalReportOutputDir(nitpickerFilePath: string): string {
	const stem = path.basename(nitpickerFilePath, path.extname(nitpickerFilePath));
	return path.resolve(process.cwd(), `${stem}-report`);
}

/**
 * Command definition for the `report` sub-command.
 * @see {@link report} for the main entry point
 */
export const commandDef = {
	desc: 'Generate a Google Sheets report or local TSV files',
	flags: {
		local: {
			type: 'boolean',
			desc: 'Write report sheets as TSV files under --output-dir (no Google Sheets)',
		},
		outputDir: {
			shortFlag: 'o',
			type: 'string',
			desc: 'Output directory for TSV files (with --local; default: <file-stem>-report)',
		},
		sheet: {
			shortFlag: 'S',
			type: 'string',
			desc: 'Google Sheets URL (required unless --local)',
		},
		credentials: {
			shortFlag: 'C',
			type: 'string',
			desc: 'Path to credentials file (Google Sheets mode only; default: ./credentials.json)',
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

/** Parsed flag values for the `report` CLI command. */
type ReportFlags = InferFlags<typeof commandDef.flags>;

/**
 * Main entry point for the `report` CLI command.
 *
 * Reads a `.nitpicker` archive and either generates a Google Sheets report
 * or writes TSV files locally when `--local` is set.
 *
 * When `--all` is specified, all sheets are generated without an interactive
 * prompt. In non-TTY environments (e.g. CI pipelines), `--all` and `--verbose`
 * are implied automatically so the command never blocks on user input and
 * error details are always available in CI logs.
 * @param args - Positional arguments; first argument is the `.nitpicker` file path
 * @param flags - Parsed CLI flags from the `report` command
 * @returns Resolves when the report is complete.
 *   Exits with code 1 if no file path is provided, no sheet URL is given, or an error occurs.
 */
export async function report(args: string[], flags: ReportFlags) {
	if (flags.verbose && !flags.silent) {
		verbosely();
	}

	const filePath = args[0];

	if (!filePath) {
		// eslint-disable-next-line no-console
		console.error('Error: No .nitpicker file specified.');
		// eslint-disable-next-line no-console
		console.error('Usage: nitpicker report <file> [options]');
		process.exit(1);
	}

	const isLocal = !!flags.local;
	const sheetUrl = flags.sheet;

	if (isLocal) {
		if (sheetUrl) {
			// eslint-disable-next-line no-console
			console.error(
				'Error: --sheet cannot be used with --local. Omit --sheet when writing TSV files.',
			);
			process.exit(1);
		}
		if (flags.credentials !== undefined) {
			// eslint-disable-next-line no-console
			console.error(
				'Error: --credentials cannot be used with --local. Omit --credentials for TSV export.',
			);
			process.exit(1);
		}
	} else if (!sheetUrl) {
		// eslint-disable-next-line no-console
		console.error(
			'Error: No Google Sheets URL specified. Use --sheet <url> or --local for TSV.',
		);
		process.exit(1);
	}

	const configFilePath = flags.config || null;
	const limit = flags.limit;
	const isTTY = process.stdout.isTTY;
	const all = flags.all || !isTTY;
	const verbose = !!flags.verbose || !isTTY;

	try {
		if (isLocal) {
			const outputDir = flags.outputDir ?? defaultLocalReportOutputDir(filePath);
			await runReportLocal({
				filePath,
				outputDir,
				configPath: configFilePath,
				limit,
				all,
				silent: flags.silent ?? false,
			});
		} else {
			const credentialFilePath = flags.credentials ?? './credentials.json';
			await runReport({
				filePath,
				sheetUrl: sheetUrl!,
				credentialFilePath,
				configPath: configFilePath,
				limit,
				all,
				silent: flags.silent ?? false,
			});
		}
	} catch (error) {
		formatCliError(error, verbose);
		process.exit(1);
	}
}
