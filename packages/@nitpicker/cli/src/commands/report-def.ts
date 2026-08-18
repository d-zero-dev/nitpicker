import type { CommandDef } from '@d-zero/roar';

/**
 * Command definition for the `report` sub-command.
 *
 * Split from `report.ts` (issue #294) so `cli.ts` can import this
 * lightweight flag/usage metadata eagerly for every command's `--help`
 * output, while the actual implementation — and everything it pulls in
 * (`@nitpicker/report-google-sheets`, its Google auth stack) — loads
 * lazily, only for the command the user actually invoked. See
 * `report.ts`'s `report` function for the main entry point.
 */
export const commandDef = {
	desc: 'Generate a Google Sheets report',
	usage: '<file> --sheet <URL> [options]',
	flags: {
		sheet: {
			shortFlag: 'S',
			type: 'string',
			isRequired: true,
			valueName: 'URL',
			desc: 'Google Sheets URL',
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
		limit: {
			shortFlag: 'l',
			type: 'number',
			default: 100_000,
			desc: 'Limit number of rows',
		},
		all: {
			type: 'boolean',
			desc: 'Generate all sheets without interactive prompt',
		},
		dedupeResources: {
			type: 'boolean',
			desc: 'Collapse the Resources sheet by canonical URL (query values stripped) and add a Count column. Useful for archives dominated by per-request unique tracking-pixel URLs.',
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
