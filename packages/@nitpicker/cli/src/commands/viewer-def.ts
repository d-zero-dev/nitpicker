import type { CommandDef } from '@d-zero/roar';

/**
 * Command definition for the `viewer` sub-command.
 *
 * Split from `viewer.ts` (issue #294) so `cli.ts` can import this
 * lightweight flag/usage metadata eagerly for every command's `--help`
 * output, while the actual implementation — and everything it pulls in
 * (`@nitpicker/viewer`, its React/jsdom-backed server) — loads lazily, only
 * for the command the user actually invoked. See `viewer.ts`'s `viewer`
 * function for the main entry point.
 */
export const commandDef = {
	desc: 'Launch a local browser viewer for a .nitpicker archive or a crawl stub directory',
	usage: '<file-or-stub-dir> [options]',
	flags: {
		port: {
			type: 'number',
			shortFlag: 'p',
			valueName: 'port',
			desc: 'Port to listen on (default: 4324, falls back to a free port)',
		},
		host: {
			type: 'string',
			valueName: 'host',
			desc: 'Hostname to bind to (default: localhost)',
		},
		open: {
			type: 'boolean',
			default: true,
			desc: 'Open the default browser automatically (use --no-open to disable)',
		},
	},
} as const satisfies CommandDef;
