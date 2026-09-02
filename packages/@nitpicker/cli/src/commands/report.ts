import type { commandDef } from './report-def.js';
import type { InferFlags } from '@d-zero/roar';

import path from 'node:path';

import { Lanes } from '@d-zero/dealer';

import { createByteProgressLogger } from '../create-byte-progress-logger.js';
import { formatCliError } from '../format-cli-error.js';
import { formatLogLine } from '../format-log-line.js';
import { readUrlListFile } from '../read-url-list-file.js';
import { verbosely } from '../report/debug.js';
import { formatInvalidReportUrlWarning } from '../report/format-invalid-report-url-warning.js';
import { formatReportUrlSkipSummary } from '../report/format-report-url-skip-summary.js';

/** Parsed flag values for the `report` CLI command. */
type ReportFlags = InferFlags<typeof commandDef.flags>;

/**
 * Main entry point for the `report` CLI command.
 *
 * Reads a `.nitpicker` archive and generates either a Google Sheets report
 * or a self-contained static HTML report.
 *
 * When `--all` is specified, all sheets are generated without an interactive
 * prompt. In non-TTY environments (e.g. CI pipelines), `--all` and `--verbose`
 * are implied automatically so the command never blocks on user input and
 * error details are always available in CI logs.
 *
 * Archive extraction progress is rendered to stderr on a single overwritten
 * `Lanes` line (one appended, timestamped line per update under `--verbose`),
 * and is suppressed entirely by `--silent`.
 *
 * `--urls <file>` restricts the report to the URLs listed in that
 * newline-delimited file, read once here via `readUrlListFile` and passed
 * raw (un-normalized) to whichever backend runs — each backend normalizes
 * against its own archive's `disableQueries` setting after opening it. It
 * combines with `--html-dirs` (AND); for Google Sheets it also restricts
 * sheet generation to Page List/Links/Violations/Images (see
 * `@nitpicker/report-google-sheets`'s `report()` docs).
 * @param args - Positional arguments; first argument is the `.nitpicker` file path
 * @param flags - Parsed CLI flags from the `report` command
 * @returns Resolves when the report is complete.
 *   Exits with code 1 if no file path is provided, the output selection is
 *   ambiguous, the `--urls` file has no valid URLs, or an error occurs.
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
	if (!!sheetUrl === !!flags.html) {
		// eslint-disable-next-line no-console
		console.error('Error: Choose exactly one output: --sheet <url> or --html.');
		process.exit(1);
	}

	// Read once, shared by both the HTML and Sheets report backends below —
	// each backend re-normalizes these raw strings against its own archive's
	// `disableQueries` setting via `resolvePageListUrlFilter` (see
	// `@nitpicker/query`), since that normalization can't happen before the
	// archive is open.
	let urls: string[] | undefined;
	if (flags.urls) {
		const urlsFlag = flags.urls;
		const resolvedListFile = path.resolve(process.cwd(), urlsFlag);
		const { urls: validUrls, invalid } = await readUrlListFile(resolvedListFile);
		if (validUrls.length === 0 && invalid.length === 0) {
			// eslint-disable-next-line no-console
			console.error(`Error: No URLs found in --urls file: ${urlsFlag}`);
			process.exit(1);
		}
		if (invalid.length > 0) {
			for (const item of invalid) {
				// eslint-disable-next-line no-console -- operator-facing warning, must be visible regardless of --silent
				console.warn(formatInvalidReportUrlWarning(urlsFlag, item));
			}
			// eslint-disable-next-line no-console -- see above
			console.warn(
				formatReportUrlSkipSummary(invalid.length, validUrls.length + invalid.length),
			);
		}
		if (validUrls.length === 0) {
			// eslint-disable-next-line no-console
			console.error(
				`Error: All ${invalid.length} line(s) in --urls file failed URL validation: ${urlsFlag}`,
			);
			process.exit(1);
		}
		urls = validUrls;
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
		const runReport = flags.html
			? async () => {
					const { report } = await import('@nitpicker/report-html');
					await report({
						filePath,
						outputPath: flags.output,
						directoryInput: flags.htmlDirs,
						urls,
						interactive: !!isTTY,
						silent: flags.silent ?? false,
						onExtractProgress,
					});
				}
			: async () => {
					const { report } = await import('@nitpicker/report-google-sheets');
					await report({
						filePath,
						sheetUrl: sheetUrl!,
						credentialFilePath,
						configPath: configFilePath,
						all,
						silent: flags.silent ?? false,
						dedupeResources: flags.dedupeResources,
						urls,
						onExtractProgress,
					});
				};
		await runReport().finally(closeExtractLanes);
	} catch (error) {
		if (error instanceof Error && error.name === 'HtmlReportCancelledError') {
			process.exit(0);
		}
		formatCliError(error, verbose);
		process.exit(1);
	}
}
