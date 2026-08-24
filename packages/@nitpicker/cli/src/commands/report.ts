import type { commandDef } from './report-def.js';
import type { InferFlags } from '@d-zero/roar';

import { report as runReport } from '@nitpicker/report-google-sheets';

import { createByteProgressLogger } from '../create-byte-progress-logger.js';
import { formatCliError } from '../format-cli-error.js';
import { formatLogLine } from '../format-log-line.js';
import { verbosely } from '../report/debug.js';

/** Parsed flag values for the `report` CLI command. */
type ReportFlags = InferFlags<typeof commandDef.flags>;

/**
 * Main entry point for the `report` CLI command.
 *
 * Reads a `.nitpicker` archive and generates a Google Sheets report
 * by delegating to `@nitpicker/report-google-sheets`. Requires a Google
 * Sheets URL and a service account credentials file.
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
		console.error('Usage: npx @nitpicker/cli report <file> [options]');
		process.exit(1);
	}

	const sheetUrl = flags.sheet;

	if (!sheetUrl) {
		// eslint-disable-next-line no-console
		console.error('Error: No Google Sheets URL specified. Use --sheet <url>.');
		process.exit(1);
	}

	const credentialFilePath = flags.credentials;
	const configFilePath = flags.config || null;
	const isTTY = process.stdout.isTTY;
	const all = flags.all || !isTTY;
	const verbose = !!flags.verbose || !isTTY;

	// `report-google-sheets` stays UI-agnostic (issue #294): it only exposes
	// a raw `(readBytes, totalBytes)` callback, so this command owns turning
	// it into a display. Plain appended lines rather than a `Lanes` overwrite
	// line — the extraction fully completes (and stops calling this) before
	// `report()` constructs its own `Lanes` for the sheet-generation phase,
	// but nothing here can observe that boundary to close a shared `Lanes`
	// at the right moment, so two independently-repainting `Lanes` instances
	// racing for the same terminal region is a real risk this sidesteps.
	const onExtractProgress = flags.silent
		? undefined
		: createByteProgressLogger(
				(message) => {
					process.stderr.write(`${formatLogLine(verbose, message)}\n`);
				},
				'Extracting archive',
				{ animated: false },
			);

	try {
		await runReport({
			filePath,
			sheetUrl,
			credentialFilePath,
			configPath: configFilePath,
			all,
			silent: flags.silent ?? false,
			dedupeResources: flags.dedupeResources ?? false,
			onExtractProgress,
		});
	} catch (error) {
		formatCliError(error, verbose);
		process.exit(1);
	}
}
