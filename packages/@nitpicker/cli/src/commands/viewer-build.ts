import type { commandDef } from './viewer-build-def.js';
import type { InferFlags } from '@d-zero/roar';

import { existsSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

import { Lanes } from '@d-zero/dealer';
import { Archive, copyFileWithProgress } from '@nitpicker/crawler';
import {
	buildViewerReadModelInWorker,
	ensureViewerReadModelInWorker,
	runViewerReadModelBackfillsInWorker,
} from '@nitpicker/query';

import { createByteProgressLogger } from '../create-byte-progress-logger.js';
import { ExitCode } from '../exit-code.js';
import { formatCliError } from '../format-cli-error.js';
import { formatViewerReadModelPhase } from '../format-viewer-read-model-phase.js';
import { formatViewerReadModelProgress } from '../format-viewer-read-model-progress.js';
import { WRITE_STEP_LABELS } from '../write-step-labels.js';

/** Parsed flag values for the `viewer-build` CLI command. */
type ViewerBuildFlags = InferFlags<typeof commandDef.flags>;

/**
 * The single `Lanes` line every progress update in this command overwrites —
 * the extraction, the worker tasks, and the archive write-back run
 * sequentially, never concurrently, so one lane is enough (issue #294:
 * these used to each print their own stream of `console.error` lines,
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
 * why the build failed in the first place. Both the backup copy and the
 * restore copy go through `copyFileWithProgress` with byte progress (issue
 * #294) — a 15 GB+ archive's `.bak` copy alone can run for tens of seconds,
 * and previously showed nothing at all (before the display even existed) on
 * the way in, or nothing (`using lanes` already disposed by the time
 * `catch` ran) on the way out.
 *
 * `lanes` is declared before the `try` block, not inside it (issue #294):
 * the catch clause's restore-from-backup copy needs the same display, and a
 * `using` declared inside `try` is already disposed — its timers cleared —
 * by the time `catch` runs.
 *
 * Every step shares one `Lanes` line (issue #294): each used to print its
 * own uncapped stream of `console.error` lines, which floods the terminal
 * on a large archive instead of reading as live progress. Pass `--verbose`
 * to switch that one line to appended, ISO-8601-timestamped lines instead —
 * the only way to see which specific phase a slow build is spending its
 * time in.
 *
 * Every DB mutation runs in a worker thread (issue #294): the knex/libsql
 * driver executes SQL synchronously on the calling thread, so any in-thread
 * work would freeze that `Lanes` line — and the SIGINT handler — for the
 * whole duration of each long statement (minutes per `CREATE INDEX` on a
 * large archive). A rebuild goes through `buildViewerReadModelInWorker` /
 * `ensureViewerReadModelInWorker`; when the schema-version gate skips the
 * rebuild, the three unconditional backfills go through
 * `runViewerReadModelBackfillsInWorker` instead (a build already includes
 * them — see the dispatch comment at the call site). The main thread only
 * relays worker messages into the display, extracts the tar on the way in,
 * and re-tars it on the way out (both with byte progress).
 *
 * Tracks the most-recently-started phase in `currentPhase` so `onProgress`
 * updates (nearly every phase reports sub-progress — see
 * `ViewerReadModelBuildProgress`'s docs for the per-phase unit) are labeled
 * with the right phase name and unit — e.g. `Creating indexes: 23/59
 * indexes`, not a bare, unlabeled `23/59`.
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

	// Constructed before the `.bak` copy, not inside the `try` below (issue
	// #294): a 15 GB+ archive's backup copy alone can take tens of seconds,
	// and the display must already be alive to show it. Deliberately NOT
	// scoped to the `try` block — the catch clause's restore-from-backup
	// copy needs this same display, and a `using` declared inside `try`
	// would already be disposed (timers cleared) by the time `catch` runs.
	using lanes = new Lanes({
		verbose: flags.verbose,
		indent: '  ',
		stream: process.stderr,
	});
	const log = (message: string) => logLine(lanes, flags.verbose, message);

	log('%braille% Backing up archive%dots%');
	await copyFileWithProgress(
		absFilePath,
		backupPath,
		createByteProgressLogger(log, 'Backing up archive'),
	);

	try {
		log('%braille% Extracting archive%dots%');
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
			onExtractProgress: createByteProgressLogger(log, 'Extracting archive'),
		});
		log('%braille% Viewer read model build: starting%dots%');
		let currentPhase: Parameters<typeof formatViewerReadModelPhase>[0] | undefined;
		const onPhase = (phase: Parameters<typeof formatViewerReadModelPhase>[0]) => {
			currentPhase = phase;
			log(formatViewerReadModelPhase(phase));
		};
		const onProgress = (
			progress: Parameters<typeof formatViewerReadModelProgress>[0],
		) => {
			log(formatViewerReadModelProgress(progress, currentPhase));
		};
		const built = flags.force
			? (await buildViewerReadModelInWorker(archive, { onPhase, onProgress }), true)
			: await ensureViewerReadModelInWorker(archive, { onPhase, onProgress });
		// A build includes the three unconditional backfills (body_hash,
		// alias_of_id, dedupe_cap_event_id) internally, so they only need
		// their own pass when the schema-version gate skipped the build —
		// the maintenance case these backfills exist for: none of them is
		// covered by that gate (body_hash/alias_of_id never changed the
		// read-model schema; dedupe_cap_event_id's data changes on every
		// re-crawl without a schema change), so an already-current archive
		// would otherwise never catch its data up. Run in a worker for the
		// same reason as the build itself: their synchronous SQL — and the
		// WAL checkpoint folding their writes back — would freeze the main
		// thread's display for minutes on a large archive (issue #294).
		if (!built) {
			await runViewerReadModelBackfillsInWorker(archive, { onPhase, onProgress });
		}
		log('Viewer read model build: completed');
		await archive.write({
			onStep: (step) => {
				log(`%braille% ${WRITE_STEP_LABELS[step]}%dots%`);
			},
			onTarProgress: createByteProgressLogger(log, 'Writing archive'),
		});
		await ignoreEnoent(unlink(backupPath));
	} catch (error) {
		try {
			log('%braille% Restoring archive from backup%dots%');
			await copyFileWithProgress(
				backupPath,
				absFilePath,
				createByteProgressLogger(log, 'Restoring archive from backup'),
			);
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
