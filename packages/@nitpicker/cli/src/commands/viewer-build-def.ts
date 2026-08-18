import type { CommandDef } from '@d-zero/roar';

/**
 * Command definition for the `viewer-build` sub-command.
 *
 * Split from `viewer-build.ts` (issue #294) so `cli.ts` can import this
 * lightweight flag/usage metadata eagerly for every command's `--help`
 * output, while the actual implementation — and everything it pulls in
 * (`@nitpicker/query`'s worker-backed read-model builder) — loads lazily,
 * only for the command the user actually invoked. See `viewer-build.ts`'s
 * `viewerBuild` function for the main entry point.
 */
export const commandDef = {
	desc: "Build (or rebuild) a .nitpicker archive's persistent viewer read model",
	usage: '<archive> [options]',
	flags: {
		force: {
			type: 'boolean',
			desc: 'Always rebuild, even if the read model is already current (default: only build when missing/stale)',
		},
		verbose: {
			type: 'boolean',
			desc: 'Append each progress/phase line with an ISO 8601 timestamp instead of overwriting a single line — for timing which step of a slow build is the bottleneck (issue #294)',
		},
	},
} as const satisfies CommandDef;
