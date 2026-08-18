import type { CommandDef } from '@d-zero/roar';

/**
 * Command definition for the `cache` sub-command.
 *
 * Split from `cache.ts` (issue #294) so `cli.ts` can import this
 * lightweight flag/usage metadata eagerly for every command's `--help`
 * output, while the actual implementation loads lazily, only for the
 * command the user actually invoked. See `cache.ts`'s `cache` function for
 * the main entry point.
 */
export const commandDef = {
	desc: 'List or clear on-disk viewer caches (tar-extraction cache and the analyze table cache)',
	usage: ['list [options]', 'clear [archive]'],
	flags: {
		json: {
			type: 'boolean',
			desc: 'Output as JSON instead of a human-readable table',
		},
	},
	subCommands: {
		list: {
			desc: 'List cache entries with their size and last-updated time',
			usage: 'list [options]',
			flags: ['json'],
		},
		clear: {
			desc: 'Delete all caches, or only the caches of the given archive',
			usage: 'clear [archive]',
			flags: [],
		},
	},
} as const satisfies CommandDef;
