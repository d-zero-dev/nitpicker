import type { CommandDef, InferFlags } from '@d-zero/roar';

import { existsSync, statSync } from 'node:fs';
import { copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { Lanes } from '@d-zero/dealer';
import { Archive } from '@nitpicker/crawler';
import {
	backfillAliasOfId,
	backfillBodyHashFromHtmlBlobs,
	backfillDedupeCapEventId,
	buildViewerReadModel,
	ensureViewerReadModel,
} from '@nitpicker/query';

import { ExitCode } from '../exit-code.js';
import { formatCliError } from '../format-cli-error.js';
import { formatProgressCount } from '../format-progress-count.js';
import { formatViewerReadModelPhase } from '../format-viewer-read-model-phase.js';
import { formatViewerReadModelProgress } from '../format-viewer-read-model-progress.js';

/**
 * Command definition for the `viewer-build` sub-command.
 * @see {@link viewerBuild} for the main entry point
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

/** Parsed flag values for the `viewer-build` CLI command. */
type ViewerBuildFlags = InferFlags<typeof commandDef.flags>;

/**
 * The single `Lanes` line every progress update in this command overwrites —
 * `buildViewerReadModel`/`ensureViewerReadModel` and the three backfills
 * below run sequentially, never concurrently, so one lane is enough (issue
 * #294: these used to each print their own stream of `console.error` lines,
 * flooding the terminal on large archives instead of showing live progress).
 */
const PROGRESS_LANE_ID = 0;

/**
 * Updates the shared progress lane, prefixing with an ISO 8601 timestamp in
 * `--verbose` mode (issue #294) — every phase/progress update in this
 * command goes through this one function so `--verbose` times all of them
 * consistently, not just a subset. Timestamps are omitted by default: a
 * single overwriting `Lanes` line has no history of prior lines to
 * correlate a timestamp against, so it would just flicker uselessly.
 * @param lanes - The command's single-lane progress display.
 * @param verbose - Whether to prefix with a timestamp (from `flags.verbose`).
 * @param message - The line to display.
 */
function logLine(lanes: Lanes, verbose: boolean | undefined, message: string): void {
	lanes.update(
		PROGRESS_LANE_ID,
		verbose ? `${new Date().toISOString()} ${message}` : message,
	);
}

/**
 * Await a filesystem promise but silently swallow only `ENOENT` errors. Any
 * other failure (permissions, disk full, etc.) propagates so the caller can
 * react instead of guessing whether the operation worked. Mirrors
 * `CrawlerOrchestrator`'s private helper of the same name/shape (not
 * exported from `@nitpicker/crawler`, so duplicated here rather than reached
 * across package boundaries for a 5-line utility).
 * @param promise - Filesystem operation to await.
 */
async function ignoreEnoent(promise: Promise<unknown>): Promise<void> {
	try {
		await promise;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}
}

/**
 * Main entry point for the `viewer-build` CLI command.
 *
 * Explicitly (re)builds the persistent viewer read model inside an existing
 * `.nitpicker` archive — issue #112's "explicit build command" trigger,
 * complementing the automatic crawl-completion build. Useful for upgrading
 * archives crawled before the read model existed (so viewer/MCP/query CLI
 * opens never pay an on-open build cost) or for forcing a clean rebuild.
 *
 * Mutates the archive in place using the same `.bak`-then-restore pattern as
 * `crawl --append`/`--retry-failed`: a backup is taken before any write and
 * restored automatically if the build or the write-back fails, so a
 * corrupted/interrupted run never leaves the archive in a half-built state.
 * If the restore itself also fails, both errors are surfaced together (via
 * `AggregateError`) rather than letting the restore failure silently mask
 * why the build failed in the first place.
 *
 * The read-model build and the three backfills that follow it all share one
 * `Lanes` line (issue #294): each used to print its own uncapped stream of
 * `console.error` lines, which floods the terminal on a large archive
 * instead of reading as live progress. Pass `--verbose` to switch that one
 * line to appended, ISO-8601-timestamped lines instead — the only way to
 * see which specific phase a slow build is spending its time in.
 *
 * Tracks the most-recently-started phase in `currentPhase` so `onProgress`
 * updates (only `buildingPages`, `creatingIndexes`, and `buildingAnchorFacts`
 * report sub-progress) are labeled with the right phase name and unit — e.g.
 * `Creating indexes: 23/57 indexes`, not a bare, unlabeled `23/57`.
 * @param args - Positional arguments; first is the `.nitpicker` file path.
 * @param flags - Parsed CLI flags from the `viewer-build` command.
 * @returns Resolves when the build (or no-op) completes.
 *   Exits with code 1 if the archive path is missing/invalid or an error occurs.
 */
export async function viewerBuild(
	args: string[],
	flags: ViewerBuildFlags,
): Promise<void> {
	const filePath = args[0];
	if (!filePath) {
		// eslint-disable-next-line no-console
		console.error('Error: No .nitpicker file specified.');
		// eslint-disable-next-line no-console
		console.error(
			'Usage: npx @nitpicker/cli viewer-build <archive> [--force] [--verbose]',
		);
		process.exit(ExitCode.Fatal);
	}

	const absFilePath = path.isAbsolute(filePath)
		? filePath
		: path.resolve(process.cwd(), filePath);

	if (!existsSync(absFilePath)) {
		// eslint-disable-next-line no-console
		console.error(`Error: Archive not found: ${absFilePath}`);
		process.exit(ExitCode.Fatal);
	}

	if (!statSync(absFilePath).isFile()) {
		// eslint-disable-next-line no-console
		console.error(
			`Error: Not a .nitpicker file (stub crawl directories are not supported): ${absFilePath}`,
		);
		process.exit(ExitCode.Fatal);
	}

	const backupPath = `${absFilePath}.bak`;
	if (existsSync(backupPath)) {
		// eslint-disable-next-line no-console
		console.error(`Error: Stale backup present: ${backupPath} — remove it first`);
		process.exit(ExitCode.Fatal);
	}

	await copyFile(absFilePath, backupPath);

	try {
		// No explicit `cwd`: matches every other Archive.open call site in
		// this CLI (crawl.ts, diff.ts), which all default to process.cwd()
		// for the transient extraction scratch dir regardless of where the
		// target archive itself lives.
		//
		// See `ArchiveOpenOptions.openPluginData` for why this must be
		// `true` (the `write()` below re-tars the whole tmpDir).
		await using archive = await Archive.open({
			filePath: absFilePath,
			openPluginData: true,
		});
		using lanes = new Lanes({
			verbose: flags.verbose,
			indent: '  ',
			stream: process.stderr,
		});
		logLine(lanes, flags.verbose, 'Viewer read model build: starting');
		let currentPhase: Parameters<typeof formatViewerReadModelPhase>[0] | undefined;
		const onPhase = (phase: Parameters<typeof formatViewerReadModelPhase>[0]) => {
			currentPhase = phase;
			logLine(lanes, flags.verbose, formatViewerReadModelPhase(phase));
		};
		const onProgress = (
			progress: Parameters<typeof formatViewerReadModelProgress>[0],
		) => {
			logLine(
				lanes,
				flags.verbose,
				formatViewerReadModelProgress(progress, currentPhase),
			);
		};
		if (flags.force) {
			await buildViewerReadModel(archive, { onPhase, onProgress });
		} else {
			await ensureViewerReadModel(archive, { onPhase, onProgress });
		}
		// Not folded into the branches above: `ensureViewerReadModel`'s
		// schema-version gate answers "does the read model need a
		// rebuild", which is the wrong question for this backfill —
		// `body_hash` didn't change the read-model schema, so an archive
		// whose read model is already current would otherwise never run
		// it. Called unconditionally here so `viewer-build` (with or
		// without `--force`) always catches up a legacy archive's
		// `body_hash` values; its own row-count guard makes the
		// `--force` branch's second call (buildViewerReadModel already
		// ran it once above) a cheap no-op.
		await backfillBodyHashFromHtmlBlobs(archive, (processed, total) => {
			logLine(
				lanes,
				flags.verbose,
				`Backfilling page content hashes: ${formatProgressCount(processed, total)}`,
			);
		});
		// Must run after the body_hash backfill above: alias_of_id's
		// trailing-slash tier requires body_hash to already be computed
		// for both candidate pages. Called unconditionally for the same
		// schema-version-gate reason as backfillBodyHashFromHtmlBlobs —
		// alias_of_id does not change the read-model schema either, so
		// `ensureViewerReadModel` alone would never trigger this on an
		// already-current archive.
		await backfillAliasOfId(archive, (processed, total) => {
			logLine(
				lanes,
				flags.verbose,
				`Backfilling duplicate page links: ${formatProgressCount(processed, total)}`,
			);
		});
		// Unlike the two backfills above, `dedupe_cap_event_id`'s initial
		// rollout IS covered by a read-model schema bump (`viewer_pages.
		// is_dedupe_capped` needs one) — but the same gate-bypass problem
		// resurfaces on every later `--append`/`--retry-failed` re-crawl
		// of an already-current archive: new `dedupe_cap_events` rows or
		// newly-discovered pages matching an existing shape would never
		// get (re-)marked, since `ensureViewerReadModel`'s version check
		// only answers "did the schema change," not "did the underlying
		// data." Called unconditionally here for that ongoing-maintenance
		// case, same as `backfillBodyHashFromHtmlBlobs`/`backfillAliasOfId`.
		await backfillDedupeCapEventId(archive, (processed, total) => {
			logLine(
				lanes,
				flags.verbose,
				`Backfilling dedupe-cap markers: ${formatProgressCount(processed, total)}`,
			);
		});
		logLine(lanes, flags.verbose, 'Viewer read model build: completed, writing archive…');
		await archive.write();
		await ignoreEnoent(unlink(backupPath));
	} catch (error) {
		try {
			await copyFile(backupPath, absFilePath);
			await ignoreEnoent(unlink(backupPath));
		} catch (restoreError) {
			formatCliError(
				new AggregateError(
					[error, restoreError],
					`viewer-build failed AND restore from backup failed. Original archive backup is left at: ${backupPath}`,
				),
				false,
			);
			process.exit(ExitCode.Fatal);
		}
		formatCliError(error, false);
		process.exit(ExitCode.Fatal);
	}
}
