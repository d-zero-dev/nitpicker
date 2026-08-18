import type { commandDef } from './viewer-def.js';
import type { InferFlags } from '@d-zero/roar';

import path from 'node:path';

import { startViewer } from '@nitpicker/viewer';

import { createByteProgressLogger } from '../create-byte-progress-logger.js';
import { ExitCode } from '../exit-code.js';
import { formatCliError } from '../format-cli-error.js';

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

	try {
		await startViewer({
			filePath: absFilePath,
			port: flags.port,
			host: flags.host,
			open: flags.open,
			// `@nitpicker/viewer` stays UI-agnostic (issue #294): it only
			// exposes a raw `(readBytes, totalBytes)` callback, so this
			// command owns turning it into a display. Plain appended lines
			// rather than a `Lanes` overwrite line — extraction fully
			// completes (and stops calling this) before `startViewer` prints
			// its own stale-read-model warning and startup banner, but
			// nothing here can observe that boundary to close a shared
			// `Lanes` at the right moment.
			onExtractProgress: createByteProgressLogger(
				(message) => {
					process.stderr.write(`${message}\n`);
				},
				'Extracting archive',
				{ animated: false },
			),
		});
	} catch (error) {
		formatCliError(error, false);
		process.exit(ExitCode.Fatal);
	}
}
