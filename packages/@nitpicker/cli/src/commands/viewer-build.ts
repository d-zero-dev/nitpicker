import type { commandDef } from './viewer-build-def.js';
import type { StepContext } from '@d-zero/dealer';
import type { InferFlags } from '@d-zero/roar';
import type { Archive as ArchiveType } from '@nitpicker/crawler';

import { existsSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

import { TaskList, TaskListStepError } from '@d-zero/dealer';
import { Archive, copyFileWithProgress } from '@nitpicker/crawler';
import {
	buildViewerReadModelInWorker,
	getViewerReadModelVersion,
	runViewerReadModelBackfillsInWorker,
	VIEWER_READ_MODEL_SCHEMA_VERSION,
} from '@nitpicker/query';

import { appendViewerReadModelPhaseRows } from '../append-viewer-read-model-phase-rows.js';
import { createVerboseTimestampStream } from '../crawl/create-verbose-timestamp-stream.js';
import { dedupeProgressMessage } from '../dedupe-progress-message.js';
import { ExitCode } from '../exit-code.js';
import { formatByteProgress } from '../format-byte-progress.js';
import { formatCliError } from '../format-cli-error.js';
import { VIEWER_READ_MODEL_BACKFILL_PHASES } from '../viewer-read-model-backfill-phases.js';
import { VIEWER_READ_MODEL_FULL_BUILD_PHASES } from '../viewer-read-model-full-build-phases.js';
import { WRITE_STEP_LABELS } from '../write-step-labels.js';

/** Parsed flag values for the `viewer-build` CLI command. */
type ViewerBuildFlags = InferFlags<typeof commandDef.flags>;

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
 * Unwraps a `TaskListStepError` (thrown by `TaskList.run()` when one of its
 * steps fails) down to the original cause, so the operator sees the real
 * error (`Error: disk full`) instead of dealer's step-wrapper text (`Error:
 * Step "Write archive" (index: 3) failed: disk full`). Passes any other
 * error through unchanged (issue #294). Mirrors `crawl.ts`'s helper of the
 * same name — an `instanceof` check, deliberately not a duck-typed
 * `'cause' in error` test, which would also match any unrelated error that
 * happens to carry a `cause`.
 * @param error - The error a `TaskList.run()` call rejected with.
 * @returns The unwrapped cause, or `error` itself if it isn't a `TaskListStepError`.
 */
function unwrapTaskListStepError(error: unknown): unknown {
	return error instanceof TaskListStepError ? error.cause : error;
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
 * #294) — a 15 GB+ archive's `.bak` copy alone can run for tens of seconds.
 *
 * Rendered as three sequential `@d-zero/dealer` `TaskList`s (issue #294's
 * original single-`Lanes`-line design, migrated once `TaskList` gained
 * per-phase row expansion): `Back up archive` → `Extract archive` (list 1),
 * then one row per internal read-model phase (list 2 — every
 * `buildViewerReadModel` phase fully expanded, not collapsed into a single
 * text-swapping row), then `Write archive` (list 3). Three separate
 * `TaskList.run()` calls rather than one continuous pipeline because which
 * phase array list 2 renders (`VIEWER_READ_MODEL_FULL_BUILD_PHASES` or
 * `VIEWER_READ_MODEL_BACKFILL_PHASES`) depends on `getViewerReadModelVersion`,
 * which can only be read once list 1 has extracted the archive — dealer's
 * `Lanes` single-instance constraint only forbids two `TaskList`s (or a
 * `TaskList` and `Lanes`/`deal()`) running *concurrently*, not several
 * running one after another on the same stream. A failure stops whichever
 * list is running immediately (later rows/lists never start) and runs the
 * `.bak` restore as its own separate, single-row task list, since restore is
 * not part of the planned sequence that just failed.
 *
 * Every DB mutation runs in a worker thread (issue #294): the knex/libsql
 * driver executes SQL synchronously on the calling thread, so any in-thread
 * work would freeze the display and the SIGINT handler for the whole
 * duration of each long statement (minutes per `CREATE INDEX` on a large
 * archive). A rebuild goes through `buildViewerReadModelInWorker`; the
 * backfill fallback (schema already current) goes through
 * `runViewerReadModelBackfillsInWorker`. The main thread only relays worker
 * messages into the display, extracts the tar on the way in, and re-tars it
 * on the way out (both with byte progress).
 *
 * `appendViewerReadModelPhaseRows` (`../append-viewer-read-model-phase-rows.js`)
 * owns the per-phase row mechanics — each row settles in step with the
 * single underlying worker call's `onPhase` progression, and `onProgress`
 * updates (nearly every phase reports sub-progress — see
 * `ViewerReadModelBuildProgress`'s docs for the per-phase unit) render on
 * whichever row is currently active without repeating that row's own label.
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

	const verbose = !!flags.verbose;
	const baseStream = process.stderr;
	const stream = verbose ? createVerboseTimestampStream(baseStream) : baseStream;

	// Tracked outside the pipeline: a `TaskList` chain has no single lexical
	// scope spanning every step (each `.pipe()` callback is its own closure),
	// so the archive reference is captured here and closed in the `finally`
	// below regardless of which step (if any past 'Extract archive') failed —
	// releasing its lock no matter where the pipeline stopped. A failure from
	// `close()` itself is swallowed rather than folded into the
	// restore-from-backup `AggregateError`: that pairing isn't a deliberately
	// designed behavior worth the added complexity, just what happens to be
	// convenient here.
	//
	// `backupComplete` guards the restore-on-failure branch below: a failure
	// *during* the backup copy itself can leave `backupPath` truncated/
	// partial (`copyFileWithProgress` does not clean up on error), and
	// restoring that broken copy back over `absFilePath` would destroy a
	// still-intact original archive. Restoring must only run once the backup
	// is known to have actually completed.
	const lifecycle: { archive: ArchiveType | null; backupComplete: boolean } = {
		archive: null,
		backupComplete: false,
	};

	try {
		const archive = await TaskList.pipe(
			'Back up archive',
			async (_input: undefined, ctx: StepContext<void>) => {
				const reportProgress = dedupeProgressMessage((message) => {
					ctx.progress(message);
				});
				await copyFileWithProgress(absFilePath, backupPath, (bytes, totalBytes) => {
					reportProgress(formatByteProgress(bytes, totalBytes));
				});
				lifecycle.backupComplete = true;
			},
		)
			.pipe('Extract archive', async (_input: void, ctx: StepContext<ArchiveType>) => {
				const reportProgress = dedupeProgressMessage((message) => {
					ctx.progress(message);
				});
				// No explicit `cwd`: matches every other Archive.open call
				// site in this CLI (crawl.ts, diff.ts), which all default
				// to process.cwd() for the transient extraction scratch
				// dir regardless of where the target archive itself lives.
				//
				// See `ArchiveOpenOptions.openPluginData` for why this
				// must be `true` (the `write()` below re-tars the whole
				// tmpDir).
				const archive = await Archive.open({
					filePath: absFilePath,
					openPluginData: true,
					onExtractProgress: (bytes, totalBytes) => {
						reportProgress(formatByteProgress(bytes, totalBytes));
					},
					// A legacy archive's self-healing schema migrations run
					// synchronously inside this call (issue #294) — without
					// this, their `console.error` notices print mid-redraw
					// of this very row, corrupting dealer's cursor tracking
					// (visible as the whole task list re-rendering from
					// scratch).
					onLog: reportProgress,
				});
				lifecycle.archive = archive;
				return archive;
			})
			.run({ stream, verbose });

		// Plain read, not a TaskList row: the schema-version gate can only be
		// checked once the archive is extracted (above), but which phase array
		// the next TaskList renders must be fixed before that TaskList is
		// built — so the decision sits here, between the two lists, mirroring
		// every other "TaskList front, plain throw" boundary in this file
		// (issue #294).
		const fullBuild =
			!!flags.force ||
			(await getViewerReadModelVersion(archive)) !== VIEWER_READ_MODEL_SCHEMA_VERSION;

		await appendViewerReadModelPhaseRows(
			TaskList.from(archive),
			fullBuild ? VIEWER_READ_MODEL_FULL_BUILD_PHASES : VIEWER_READ_MODEL_BACKFILL_PHASES,
			{
				getArchive: (a: ArchiveType) => a,
				runBuild: fullBuild
					? buildViewerReadModelInWorker
					: runViewerReadModelBackfillsInWorker,
			},
		).run({ stream, verbose });

		await TaskList.pipe(
			'Write archive',
			async (_input: undefined, ctx: StepContext<void>) => {
				const reportProgress = dedupeProgressMessage((message) => {
					ctx.progress(message);
				});
				await archive.write({
					onStep: (step) => {
						reportProgress(WRITE_STEP_LABELS[step]);
					},
					onTarProgress: (writtenBytes, totalBytes) => {
						reportProgress(formatByteProgress(writtenBytes, totalBytes));
					},
				});
				await ignoreEnoent(unlink(backupPath));
			},
		).run({ stream, verbose });
	} catch (error) {
		const cause = unwrapTaskListStepError(error);
		if (!lifecycle.backupComplete) {
			// The backup itself never finished — nothing has been mutated yet
			// (extraction/build/write all run after it), so there is nothing
			// to restore. Restoring a partial `backupPath` here would destroy
			// the still-intact original archive.
			await lifecycle.archive?.close().catch(() => {});
			formatCliError(cause, false);
			process.exit(ExitCode.Fatal);
		}
		try {
			await TaskList.pipe('Restore from backup', async (_input: undefined, ctx) => {
				const reportProgress = dedupeProgressMessage((message) => {
					ctx.progress(message);
				});
				await copyFileWithProgress(backupPath, absFilePath, (bytes, totalBytes) => {
					reportProgress(formatByteProgress(bytes, totalBytes));
				});
				await ignoreEnoent(unlink(backupPath));
			}).run({ stream, verbose });
		} catch (restoreError) {
			const restoreCause = unwrapTaskListStepError(restoreError);
			// `close()` runs before `process.exit()`, not in a `finally`
			// (issue #294): `process.exit()` terminates the process
			// immediately, before a sibling `finally` block gets to run —
			// a `finally` here would never actually release the handle.
			await lifecycle.archive?.close().catch(() => {});
			formatCliError(
				new AggregateError(
					[cause, restoreCause],
					`viewer-build failed AND restore from backup failed. Original archive backup is left at: ${backupPath}`,
				),
				false,
			);
			process.exit(ExitCode.Fatal);
		}
		await lifecycle.archive?.close().catch(() => {});
		formatCliError(cause, false);
		process.exit(ExitCode.Fatal);
	}
	await lifecycle.archive?.close().catch(() => {});
}
