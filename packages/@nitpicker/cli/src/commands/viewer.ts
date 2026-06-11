import type { CommandDef, InferFlags } from '@d-zero/roar';

import path from 'node:path';

import { startViewer } from '@nitpicker/viewer';

import { ExitCode } from '../exit-code.js';
import { formatCliError } from '../format-cli-error.js';

/**
 * Command definition for the `viewer` sub-command.
 * @see {@link viewer} for the main entry point
 */
export const commandDef = {
	desc: 'Launch a local browser viewer for a .nitpicker archive or a crawl stub directory',
	flags: {
		port: {
			type: 'number',
			shortFlag: 'p',
			desc: 'Port to listen on (default: 4324, falls back to a free port)',
		},
		host: {
			type: 'string',
			desc: 'Hostname to bind to (default: localhost)',
		},
		open: {
			type: 'boolean',
			default: true,
			desc: 'Open the default browser automatically (use --no-open to disable)',
		},
	},
} as const satisfies CommandDef;

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
		console.error('Usage: nitpicker viewer <file-or-stub-dir> [options]');
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
		});
	} catch (error) {
		formatCliError(error, false);
		process.exit(ExitCode.Fatal);
	}
}
