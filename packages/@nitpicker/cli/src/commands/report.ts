import type { commandDef } from './report-def.js';
import type { InferFlags } from '@d-zero/roar';

import { Lanes } from '@d-zero/dealer';
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
 *
 * Archive extraction progress is rendered to stderr on a single overwritten
 * `Lanes` line (one appended, timestamped line per update under `--verbose`),
 * and is suppressed entirely by `--silent`.
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
	// it into a display.
	//
	// The `Lanes` is created on the first callback and closed as soon as
	// `readBytes` reaches `totalBytes`, instead of spanning the whole
	// `runReport` call: only one `Lanes`/`TaskList` may repaint a given
	// terminal stream at a time (see ARCHITECTURE.md), and once the archive
	// is open `report()` goes on to run an enquirer prompt and build its own
	// `TaskList`. Creating it on demand also keeps the display absent on a
	// tar-cache hit, where the callback never fires at all.
	//
	// The handle is deliberately NOT cleared on close: a stray late callback
	// must land on the closed instance (whose `Display.write` is a no-op)
	// rather than construct a second `Lanes` on top of `report()`'s own
	// display. It lives on an object property rather than a bare `let` per
	// `cli/CLAUDE.md` — a handle only ever assigned inside a closure narrows
	// to its initializer type at every outside read.
	const extractDisplay: { lanes: Lanes | null } = { lanes: null };
	const closeExtractLanes = () => {
		extractDisplay.lanes?.close();
	};
	const renderExtractProgress = createByteProgressLogger((message) => {
		extractDisplay.lanes?.update(0, formatLogLine(verbose, message));
	}, 'Extracting archive');
	const onExtractProgress = flags.silent
		? undefined
		: (readBytes: number, totalBytes: number) => {
				extractDisplay.lanes ??= new Lanes({ verbose, stream: process.stderr });
				renderExtractProgress(readBytes, totalBytes);
				// The untar read stream is fully consumed at this point and
				// nothing further in the open path reports bytes, so this is
				// the last callback of the extraction.
				if (readBytes >= totalBytes) {
					closeExtractLanes();
				}
			};

	try {
		// `.finally()` on the promise rather than a `finally` block on the
		// `try` below: extraction that throws mid-stream never reaches 100%,
		// and the display has to close *before* `formatCliError` writes to
		// `console.error` — a `finally` block would run after that `catch`
		// (or not at all, since `process.exit` never returns), leaving a
		// still-repainting `Lanes` to corrupt the error output.
		await runReport({
			filePath,
			sheetUrl,
			credentialFilePath,
			configPath: configFilePath,
			all,
			silent: flags.silent ?? false,
			dedupeResources: flags.dedupeResources,
			onExtractProgress,
		}).finally(closeExtractLanes);
	} catch (error) {
		formatCliError(error, verbose);
		process.exit(1);
	}
}
