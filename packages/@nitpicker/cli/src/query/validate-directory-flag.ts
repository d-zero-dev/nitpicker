import type { QuerySubCommand } from './types.js';

import { parsePageDirectoryPrefix } from '@nitpicker/query';

import { commandDef } from '../commands/query-def.js';

/**
 * Rejects an unusable `--directory` before the archive is opened, for the
 * sub-commands that read it. Extracting a large `.nitpicker` takes minutes,
 * so a blank value or a non-HTTP URL should fail before that, with an error
 * that names the flag rather than the query layer's parser.
 * @param subCommand - The sub-command being run.
 * @param directory - The `--directory` value, if given.
 * @throws {Error} `Invalid --directory value: …` when a sub-command that reads the flag gets an unusable value.
 * @example
 * validateDirectoryFlag('match-selector', flags.directory);
 */
export function validateDirectoryFlag(
	subCommand: QuerySubCommand,
	directory?: string,
): void {
	const flags: readonly string[] = commandDef.subCommands[subCommand].flags;
	if (directory === undefined || !flags.includes('directory')) {
		return;
	}
	try {
		parsePageDirectoryPrefix(directory);
	} catch (error) {
		throw new Error(
			`Invalid --directory value: ${JSON.stringify(directory)} (${error instanceof Error ? error.message : String(error)}). Pass a path such as /blog, or a URL such as https://example.com/blog.`,
			{ cause: error },
		);
	}
}
