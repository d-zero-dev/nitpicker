import type { CommandDef } from '@d-zero/roar';

/**
 * Command definition for the `report` sub-command.
 *
 * Split from `report.ts` (issue #294) so `cli.ts` can import this
 * lightweight flag/usage metadata eagerly for every command's `--help`
 * output, while the actual implementation — and everything it pulls in
 * (the Google Sheets or static HTML reporter) — loads lazily, only for the
 * output selected by the user. See
 * `report.ts`'s `report` function for the main entry point.
 */
export const commandDef = {
	desc: 'Generate a Google Sheets or static HTML report',
	usage: '<file> (--sheet <URL> | --html) [options]',
	flags: {
		sheet: {
			shortFlag: 'S',
			type: 'string',
			valueName: 'URL',
			desc: 'Google Sheets URL',
		},
		html: {
			shortFlag: 'H',
			type: 'boolean',
			desc: 'Generate a self-contained static HTML report',
		},
		output: {
			shortFlag: 'o',
			type: 'string',
			valueName: 'path',
			desc: 'HTML output path (defaults to <archive-name>.html)',
		},
		htmlDirs: {
			type: 'string',
			valueName: 'URL-or-path,...',
			desc: 'Directory prefixes for HTML reports with over 10,000 inner pages',
		},
		credentials: {
			shortFlag: 'C',
			type: 'string',
			default: './credentials.json',
			valueName: 'path',
			desc: 'Path to credentials file (keep this file secure and out of version control)',
		},
		config: {
			shortFlag: 'c',
			type: 'string',
			valueName: 'path',
			desc: 'Path to config file',
		},
		all: {
			type: 'boolean',
			desc: 'Generate all sheets without interactive prompt',
		},
		dedupeResources: {
			type: 'boolean',
			default: true,
			desc: 'Collapse the Resources sheet by canonical URL (query values stripped) and add a Count column. Useful for archives dominated by per-request unique tracking-pixel URLs. Pass --no-dedupe-resources for one row per raw resource URL instead.',
		},
		verbose: {
			type: 'boolean',
			desc: 'Output verbose log to standard out',
		},
		silent: {
			type: 'boolean',
			desc: 'No output log to standard out',
		},
	},
} as const satisfies CommandDef;
