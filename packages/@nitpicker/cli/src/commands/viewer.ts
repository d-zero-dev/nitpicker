import type { commandDef } from './viewer-def.js';
import type { InferFlags } from '@d-zero/roar';

import path from 'node:path';

import { Lanes } from '@d-zero/dealer';
import { startViewer } from '@nitpicker/viewer';

import { createByteProgressLogger } from '../create-byte-progress-logger.js';
import { ExitCode } from '../exit-code.js';
import { formatCliError } from '../format-cli-error.js';
import { formatLogLine } from '../format-log-line.js';

/** Parsed flag values for the `viewer` CLI command. */
type ViewerFlags = InferFlags<typeof commandDef.flags>;

/**
 * Main entry point for the `viewer` CLI command.
 *
 * Opens the given `.nitpicker` archive and starts a local web server, then
 * stays resident until interrupted. Unlike the other (batch) commands, this
 * does not return until the server is shut down (Ctrl-C) — so the CLI's
 * trailing `process.exit` is reached only after a clean shutdown.
 * @param args - Positional arguments; the first is the `.nitpicker` file path.
 * @param flags - Parsed CLI flags from the `viewer` command.
 * @returns Resolves only after the server has shut down.
 *   Exits with code 1 if the file is missing/invalid or an error occurs.
 */
export async function viewer(args: string[], flags: ViewerFlags) {
	const filePath = args[0];
	if (!filePath) {
		// eslint-disable-next-line no-console
		console.error(
			'Error: No source specified. Pass a .nitpicker file or a crawl stub directory.',
		);
		// eslint-disable-next-line no-console
		console.error('Usage: npx @nitpicker/cli viewer <file-or-stub-dir> [options]');
		process.exit(ExitCode.Fatal);
	}

	const absFilePath = path.isAbsolute(filePath)
		? filePath
		: path.resolve(process.cwd(), filePath);

	// `@nitpicker/viewer` stays UI-agnostic (issue #294): it only exposes a
	// raw `(readBytes, totalBytes)` callback, so this command owns turning it
	// into a display.
	//
	// The `Lanes` is created on the first callback and closed as soon as
	// `readBytes` reaches `totalBytes`, instead of spanning the whole
	// `startViewer` call: `startViewer` goes on to print its stale-read-model
	// warning and startup banner straight to the console, which must not
	// collide with a still-repainting `Lanes` (see ARCHITECTURE.md). Creating
	// it on demand also keeps the display absent for a stub directory or a
	// tar-cache hit, where the callback never fires. Same boundary as
	// `report.ts`.
	//
	// `verbose` keys off stderr (where the `Lanes` writes), not stdout as in
	// `report.ts`: a non-TTY stderr can't take the ANSI cursor-movement an
	// overwriting `Lanes` emits, so it falls back to appended lines.
	//
	// The handle is deliberately NOT cleared on close: a stray late callback
	// must land on the closed instance (whose `Display.write` is a no-op)
	// rather than construct a second `Lanes`. It lives on an object property
	// rather than a bare `let` per `cli/CLAUDE.md`.
	const verbose = !process.stderr.isTTY;
	const extractDisplay: { lanes: Lanes | null } = { lanes: null };
	const closeExtractLanes = () => {
		extractDisplay.lanes?.close();
	};
	const renderExtractProgress = createByteProgressLogger((message) => {
		extractDisplay.lanes?.update(0, formatLogLine(verbose, message));
	}, 'Extracting archive');
	const onExtractProgress = (readBytes: number, totalBytes: number) => {
		extractDisplay.lanes ??= new Lanes({ verbose, stream: process.stderr });
		renderExtractProgress(readBytes, totalBytes);
		// The untar read stream is fully consumed at this point and nothing
		// further in the open path reports bytes, so this is the last
		// callback of the extraction.
		if (readBytes >= totalBytes) {
			closeExtractLanes();
		}
	};

	try {
		// `.finally()` on the promise rather than a `finally` block on the
		// `try`: extraction that throws mid-stream never reaches 100%, and the
		// display has to close *before* `formatCliError` writes to
		// `console.error` — a `finally` block would run after that `catch`
		// (or not at all, since `process.exit` never returns). For a clean
		// run this only fires at server shutdown, where closing is idempotent.
		await startViewer({
			filePath: absFilePath,
			port: flags.port,
			host: flags.host,
			open: flags.open,
			onExtractProgress,
		}).finally(closeExtractLanes);
	} catch (error) {
		formatCliError(error, false);
		process.exit(ExitCode.Fatal);
	}
}
