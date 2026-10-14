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
		skipTemplates: {
			type: 'boolean',
			desc: 'Skip re-classifying page templates in the output archive (by default they are re-derived, since per-source template keys collide when merged)',
		},
		templateMemoryBudget: {
			type: 'number',
			valueName: 'MiB',
			desc: 'Bytes a page-template block similarity table may take before the block is clustered from a sample instead of whole, in MiB (default 512; 0 samples every block; also NITPICKER_TEMPLATE_MEMORY_BUDGET; an invalid value is refused before any work starts). A table takes n*(n-1)/2*8 bytes for a block of n pages. Separately, when the blocks clustered whole would hold more than 20,000 pages, the largest are sampled too (a fixed limit)',
		},
		verbose: {
			type: 'boolean',
			desc: 'Append each progress/phase line with an ISO 8601 timestamp instead of overwriting a single line',
		},
	},
} as const satisfies CommandDef;
