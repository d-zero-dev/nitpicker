import type { commandDef } from './viewer-build-def.js';
import type { StepContext } from '@d-zero/dealer';
import type { InferFlags } from '@d-zero/roar';
import type { Archive as ArchiveType } from '@nitpicker/crawler';

import { existsSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

import { TaskList } from '@d-zero/dealer';
import { Archive, copyFileWithProgress } from '@nitpicker/crawler';
import {
	buildViewerReadModelInWorker,
	ensureViewerReadModelInWorker,
	runViewerReadModelBackfillsInWorker,
} from '@nitpicker/query';

import { createVerboseTimestampStream } from '../crawl/create-verbose-timestamp-stream.js';
import { ExitCode } from '../exit-code.js';
import { formatByteProgress } from '../format-byte-progress.js';
import { formatCliError } from '../format-cli-error.js';
import { formatViewerReadModelPhase } from '../format-viewer-read-model-phase.js';
import { formatViewerReadModelProgress } from '../format-viewer-read-model-progress.js';
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
 * Rendered as a `TaskList` (issue #294's original single-`Lanes`-line
 * design, migrated once `@d-zero/dealer` gained `TaskList`): `Back up
 * archive` → `Extract archive` → `Build viewer read model` → `Write
 * archive`, one row each. When the schema-version gate skips the rebuild,
 * the `Build viewer read model` step splices in a `Run backfills` row via
 * `ctx.insertNext` (a build already includes those backfills — see the
 * dispatch comment at the call site — so they only need their own pass here).
 * A failure stops the task list immediately (later rows stay `pending`) and
 * runs the `.bak` restore as a separate, single-row task list, since restore
 * is not part of the planned sequence that just failed.
 *
 * Every DB mutation runs in a worker thread (issue #294): the knex/libsql
 * driver executes SQL synchronously on the calling thread, so any in-thread
 * work would freeze the display and the SIGINT handler for the whole
 * duration of each long statement (minutes per `CREATE INDEX` on a large
 * archive). A rebuild goes through `buildViewerReadModelInWorker` /
 * `ensureViewerReadModelInWorker`; the backfill fallback goes through
 * `runViewerReadModelBackfillsInWorker`. The main thread only relays worker
 * messages into the display, extracts the tar on the way in, and re-tars it
 * on the way out (both with byte progress).
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
		await TaskList.pipe(
			'Back up archive',
			async (_input: undefined, ctx: StepContext<void>) => {
				await copyFileWithProgress(absFilePath, backupPath, (bytes, totalBytes) => {
					ctx.progress(formatByteProgress(bytes, totalBytes));
				});
				lifecycle.backupComplete = true;
			},
		)
			.pipe('Extract archive', async (_input: void, ctx: StepContext<ArchiveType>) => {
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
						ctx.progress(formatByteProgress(bytes, totalBytes));
					},
				});
				lifecycle.archive = archive;
				return archive;
			})
			.pipe(
				'Build viewer read model',
				async (archive: ArchiveType, ctx: StepContext<ArchiveType>) => {
					let currentPhase: Parameters<typeof formatViewerReadModelPhase>[0] | undefined;
					const onPhase = (phase: Parameters<typeof formatViewerReadModelPhase>[0]) => {
						currentPhase = phase;
						ctx.progress(formatViewerReadModelPhase(phase));
					};
					const onProgress = (
						progress: Parameters<typeof formatViewerReadModelProgress>[0],
					) => {
						ctx.progress(formatViewerReadModelProgress(progress, currentPhase));
					};
					const built = flags.force
						? (await buildViewerReadModelInWorker(archive, { onPhase, onProgress }), true)
						: await ensureViewerReadModelInWorker(archive, { onPhase, onProgress });
					// A build includes the three unconditional backfills
					// (body_hash, alias_of_id, dedupe_cap_event_id) internally,
					// so they only need their own pass when the schema-version
					// gate skipped the build — the maintenance case these
					// backfills exist for: none of them is covered by that
					// gate (body_hash/alias_of_id never changed the read-model
					// schema; dedupe_cap_event_id's data changes on every
					// re-crawl without a schema change), so an already-current
					// archive would otherwise never catch its data up.
					if (!built) {
						ctx.insertNext(
							'Run backfills',
							async (archive: ArchiveType, ctx2: StepContext<ArchiveType>) => {
								await runViewerReadModelBackfillsInWorker(archive, {
									onPhase: (phase) => {
										currentPhase = phase;
										ctx2.progress(formatViewerReadModelPhase(phase));
									},
									onProgress: (progress) => {
										ctx2.progress(formatViewerReadModelProgress(progress, currentPhase));
									},
								});
								return archive;
							},
						);
					}
					return archive;
				},
			)
			.pipe('Write archive', async (archive: ArchiveType, ctx: StepContext<void>) => {
				await archive.write({
					onStep: (step) => {
						ctx.progress(WRITE_STEP_LABELS[step]);
					},
					onTarProgress: (writtenBytes, totalBytes) => {
						ctx.progress(formatByteProgress(writtenBytes, totalBytes));
					},
				});
				await ignoreEnoent(unlink(backupPath));
			})
			.run({ stream, verbose });
	} catch (error) {
		const cause = error instanceof Error && 'cause' in error ? error.cause : error;
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
				await copyFileWithProgress(backupPath, absFilePath, (bytes, totalBytes) => {
					ctx.progress(formatByteProgress(bytes, totalBytes));
				});
				await ignoreEnoent(unlink(backupPath));
			}).run({ stream, verbose });
		} catch (restoreError) {
			const restoreCause =
				restoreError instanceof Error && 'cause' in restoreError
					? restoreError.cause
					: restoreError;
			formatCliError(
				new AggregateError(
					[cause, restoreCause],
					`viewer-build failed AND restore from backup failed. Original archive backup is left at: ${backupPath}`,
				),
				false,
			);
			process.exit(ExitCode.Fatal);
		} finally {
			await lifecycle.archive?.close().catch(() => {});
		}
		formatCliError(cause, false);
		process.exit(ExitCode.Fatal);
	}
	await lifecycle.archive?.close().catch(() => {});
}
