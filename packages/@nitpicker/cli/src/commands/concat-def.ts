import type { CommandDef } from '@d-zero/roar';

/**
 * Command definition for the `concat` sub-command.
 *
 * Split from `concat.ts` (same reasoning as every other command's
 * `-def.ts` split, e.g. `viewer-build-def.ts`) so `cli.ts` can import this
 * lightweight flag/usage metadata eagerly for every command's `--help`
 * output, while the actual implementation — and everything it pulls in
 * (`@nitpicker/crawler`'s transfer engine, `@nitpicker/query`'s
 * worker-backed read-model builder) — loads lazily, only when `concat` is
 * the command actually invoked.
 */
export const commandDef = {
	desc: 'Merge two or more .nitpicker archives into a new archive (roots = union of every source; the richest observation of a shared URL wins; never re-crawls, never promotes an external page to internal)',
	usage: '<archive> <archive> [<archive>...] -o <output> [options]',
	flags: {
		output: {
			type: 'string',
			shortFlag: 'o',
			valueName: 'path',
			isRequired: true,
			group: 'Output',
			desc: 'Output .nitpicker path. Must not already exist — ".nitpicker" is appended if missing',
		},
		verbose: {
			type: 'boolean',
			desc: 'Append each progress/phase line with an ISO 8601 timestamp instead of overwriting a single line',
		},
	},
} as const satisfies CommandDef;
