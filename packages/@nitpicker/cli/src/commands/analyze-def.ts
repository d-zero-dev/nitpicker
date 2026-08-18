import type { CommandDef } from '@d-zero/roar';

/**
 * Command definition for the `analyze` sub-command.
 *
 * Split from `analyze.ts` (issue #294) so `cli.ts` can import this
 * lightweight flag/usage metadata eagerly for every command's `--help`
 * output, while the actual implementation — and everything it pulls in
 * (`@nitpicker/core`, every `@nitpicker/analyze-*` plugin) — loads lazily,
 * only for the command the user actually invoked. See `analyze.ts`'s
 * `analyze` function for the main entry point.
 */
export const commandDef = {
	desc: 'Analyze a .nitpicker archive',
	usage: '<file> [options]',
	flags: {
		all: {
			type: 'boolean',
			desc: 'Run all analysis plugins without the interactive prompt',
		},
		plugin: {
			type: 'string',
			isMultiple: true,
			valueName: 'name',
			desc: 'Specify plugins to run (e.g. --plugin @nitpicker/analyze-axe --plugin @nitpicker/analyze-textlint)',
		},
		verbose: {
			type: 'boolean',
			desc: 'Output logs verbosely',
		},
		searchKeywords: {
			type: 'string',
			isMultiple: true,
			valueName: 'keyword',
			desc: 'Keywords for analyze-search plugin (overrides config file)',
		},
		searchScope: {
			type: 'string',
			valueName: 'selector',
			desc: 'CSS selector to narrow search scope for analyze-search plugin (overrides config file)',
		},
		axeLang: {
			type: 'string',
			valueName: 'lang',
			desc: 'BCP 47 language tag for analyze-axe plugin (overrides config file)',
		},
		templates: {
			type: 'boolean',
			desc: 'Classify pages into templates by DOM structure similarity (uses @d-zero/page-cluster)',
		},
		silent: {
			type: 'boolean',
			desc: 'No output log to standard out',
		},
	},
} as const satisfies CommandDef;
