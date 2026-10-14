import type { CommandDef } from '@d-zero/roar';

/**
 * Command definition for the `split` sub-command. See `concat-def.ts`'s
 * docs for why this file is split from `split.ts`.
 */
export const commandDef = {
	desc: "Extract the pages under the given scope URL(s) from a .nitpicker archive into a new archive (same (hostname, port, path) scope semantics as crawl roots; a kept page's out-of-scope link becomes an external stub; a --list/--list-file source archive is rejected)",
	usage: '<archive> <URL> [<URL>...] -o <output> [options]',
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
			desc: 'Skip re-classifying page templates in the output archive (by default they are re-derived from the extracted pages)',
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
