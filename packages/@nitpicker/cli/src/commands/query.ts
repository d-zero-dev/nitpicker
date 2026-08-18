import type { commandDef } from './query-def.js';
import type { QuerySubCommand } from '../query/types.js';
import type { InferFlags } from '@d-zero/roar';
import type { OpenResult } from '@nitpicker/query';

import path from 'node:path';

import { Lanes } from '@d-zero/dealer';
import { ArchiveManager } from '@nitpicker/query';

import { createByteProgressLogger } from '../create-byte-progress-logger.js';
import { formatCliError } from '../format-cli-error.js';
import { dispatchQuery } from '../query/dispatch-query.js';
import { VALID_SUB_COMMANDS } from '../query/types.js';

/** Parsed flag values for the `query` CLI command. */
type QueryFlags = InferFlags<typeof commandDef.flags>;

/**
 * Main entry point for the `query` CLI command.
 *
 * Opens a `.nitpicker` archive, dispatches the specified sub-command
 * to the appropriate `@nitpicker/query` function, and prints the result
 * as JSON to stdout.
 * @param args - Positional arguments; first is the `.nitpicker` file path, second is the sub-command.
 * @param flags - Parsed CLI flags from the `query` command.
 * @returns Resolves when the query is complete.
 *   Exits with code 1 if arguments are missing/invalid or an error occurs.
 */
export async function query(args: string[], flags: QueryFlags) {
	const filePath = args[0];
	if (!filePath) {
		// eslint-disable-next-line no-console
		console.error('Error: No .nitpicker file specified.');
		// eslint-disable-next-line no-console
		console.error('Usage: npx @nitpicker/cli query <file> <sub-command> [options]');
		process.exit(1);
	}

	const subCommandArg = args[1];
	if (!subCommandArg || !VALID_SUB_COMMANDS.includes(subCommandArg as QuerySubCommand)) {
		// eslint-disable-next-line no-console
		console.error(
			subCommandArg
				? `Error: Unknown sub-command: ${subCommandArg}`
				: 'Error: No sub-command specified.',
		);
		// eslint-disable-next-line no-console
		console.error(`Valid sub-commands: ${VALID_SUB_COMMANDS.join(', ')}`);
		process.exit(1);
	}

	const subCommand = subCommandArg as QuerySubCommand;
	const absFilePath = path.isAbsolute(filePath)
		? filePath
		: path.resolve(process.cwd(), filePath);

	try {
		// The extraction Lanes is scoped to this block (issue #294), not
		// the rest of the function: it must be disposed before
		// `dispatchQuery`'s result is printed via `console.log`, or its
		// still-repainting redraw loop would corrupt that stdout write in
		// an interactive terminal (both fds share the same terminal
		// cursor). Written to stderr so it never pollutes the stdout JSON
		// a piped `nitpicker query ... | jq` depends on.
		let manager: ArchiveManager;
		let openResult: OpenResult;
		{
			using lanes = new Lanes({ verbose: false, indent: '  ', stream: process.stderr });
			const log = (message: string) => {
				lanes.update(0, message);
			};
			log('%braille% Extracting archive%dots%');
			manager = new ArchiveManager({
				onExtractProgress: createByteProgressLogger(log, 'Extracting archive'),
			});
			openResult = await manager.open(absFilePath);
		}
		const { archiveId, accessor } = openResult;
		try {
			// Plain stderr lines, not a `Lanes` line (issue #294): this fires
			// strictly before the `console.log(output)` below, so there's no
			// shared-region redraw conflict to guard against — just a single
			// human-readable status line per `externalSortUrls` phase change,
			// safe to interleave with anything.
			const result = await dispatchQuery(accessor, subCommand, flags, (message) => {
				process.stderr.write(`${message}\n`);
			});
			const output = JSON.stringify(result, null, flags.pretty ? 2 : undefined);
			// eslint-disable-next-line no-console
			console.log(output);
		} finally {
			try {
				await manager.close(archiveId);
			} catch {
				// close failure should not mask the original error
			}
		}
	} catch (error) {
		formatCliError(error, false);
		process.exit(1);
	}
}
