import type { commandDef } from './concat-def.js';
import type { TransferOutcome } from '../transfer/types.js';
import type { StepContext } from '@d-zero/dealer';
import type { InferFlags } from '@d-zero/roar';
import type {
	ArchiveAccessor,
	Archive as ArchiveType,
	ConcatArchivesResult,
} from '@nitpicker/crawler';

import path from 'node:path';

import { TaskList } from '@d-zero/dealer';
import {
	Archive,
	CONCAT_SOURCE_TRANSFER_PHASES,
	concatArchives,
	TRANSFER_POST_PHASES,
} from '@nitpicker/crawler';
import { buildViewerReadModelInWorker } from '@nitpicker/query';

import { appendViewerReadModelPhaseRows } from '../append-viewer-read-model-phase-rows.js';
import { classifyTemplatesQuietly } from '../crawl/classify-templates-quietly.js';
import { createVerboseTimestampStream } from '../crawl/create-verbose-timestamp-stream.js';
import { dedupeProgressMessage } from '../dedupe-progress-message.js';
import { ExitCode } from '../exit-code.js';
import { formatByteProgress } from '../format-byte-progress.js';
import { formatCliError } from '../format-cli-error.js';
import { appendBridgedPhaseRows } from '../transfer/append-bridged-phase-rows.js';
import { cleanupFailedTransfer } from '../transfer/cleanup-failed-transfer.js';
import { formatTransferNotices } from '../transfer/format-transfer-notices.js';
import { resolveTransferExitCode } from '../transfer/resolve-transfer-exit-code.js';
import { validateTransferInputPaths } from '../transfer/validate-transfer-input-paths.js';
import { validateTransferOutputPath } from '../transfer/validate-transfer-output-path.js';
import { TRANSFER_PHASE_LABELS } from '../transfer-phase-labels.js';
import { unwrapTaskListStepError } from '../unwrap-task-list-step-error.js';
import { VIEWER_READ_MODEL_FULL_BUILD_PHASES } from '../viewer-read-model-full-build-phases.js';
import { WRITE_STEP_LABELS } from '../write-step-labels.js';

/** Parsed flag values for the `concat` CLI command. */
type ConcatFlags = InferFlags<typeof commandDef.flags>;

/**
 * Builds the flat, positional row-label list for one `concat` run's
 * bridged `TaskList` rows: every source's per-source transfer phases
 * (suffixed `(i/N)` when there is more than one source), then the
 * whole-operation post phases. Matches, position for position, the exact
 * `onPhase` sequence `concatArchives` documents.
 * @param sourceCount - Number of sources being merged.
 */
function buildConcatRowLabels(sourceCount: number): string[] {
	const perSource = Array.from({ length: sourceCount }, (_, index) =>
		CONCAT_SOURCE_TRANSFER_PHASES.map((phase) => {
			const label = TRANSFER_PHASE_LABELS[phase];
			return sourceCount > 1 ? `${label} (${index + 1}/${sourceCount})` : label;
		}),
	).flat();
	const post = TRANSFER_POST_PHASES.map((phase) => TRANSFER_PHASE_LABELS[phase]);
	return [...perSource, ...post];
}

/**
 * Main entry point for the `concat` CLI command — merges two or more
 * `.nitpicker` archives into a new archive. See `docs/concat.md` for the
 * full merge contract (roots union, richest-observation-wins, config
 * conflicts) this command surfaces from `@nitpicker/crawler`'s
 * `concatArchives`.
 *
 * Rendered as a single `TaskList` (every row is known statically — unlike
 * `viewer-build`, nothing here depends on a value only readable after
 * extraction): one "Extract archive" row per source, "Create output
 * archive", the bridged transfer-phase rows, "Classify page templates"
 * (unless `--skip-templates`), the viewer read-model's own phase rows, then
 * "Write archive". Sources are opened via
 * `Archive.openCached` (read-only, no lock, no `.bak` — matches
 * `diff.ts`'s own precedent for a command that only reads existing
 * archives).
 *
 * On any failure, `cleanupFailedTransfer` detaches every source and the
 * destination (`releaseHandle()`, never `close()` — see that function's
 * docs for why) and removes the destination's tmpDir/output path before
 * exiting. On success, operator notices (in-scope-but-external pages,
 * a template classification or read-model
 * build failure) print AFTER
 * the `TaskList` has fully settled, never while a row is still active.
 * @param args - Positional arguments: two or more `.nitpicker` archive paths.
 * @param flags - Parsed CLI flags from the `concat` command.
 * @returns Resolves when the merge completes. Exits with code 1 on
 *   validation/pipeline failure, 2 if pending is non-empty or the
 *   template classification / read-model build failed, 0 otherwise.
 */
export async function concat(args: string[], flags: ConcatFlags): Promise<void> {
	if (!flags.output) {
		// eslint-disable-next-line no-console
		console.error('Error: -o/--output is required.');
		// eslint-disable-next-line no-console
		console.error(
			'Usage: npx @nitpicker/cli concat <archive> <archive> [<archive>...] -o <output> [--skip-templates] [--verbose]',
		);
		process.exit(ExitCode.Fatal);
	}

	const cwd = process.cwd();
	let inputPaths: string[];
	let outputPath: string;
	try {
		inputPaths = validateTransferInputPaths(args, cwd);
		if (inputPaths.length < 2) {
			throw new Error('concat requires at least two archives');
		}
		outputPath = validateTransferOutputPath(flags.output, cwd);
	} catch (error) {
		formatCliError(error, false);
		process.exit(ExitCode.Fatal);
	}

	const verbose = !!flags.verbose;
	const baseStream = process.stderr;
	const stream = verbose ? createVerboseTimestampStream(baseStream) : baseStream;

	const state: {
		sourceAccessors: ArchiveAccessor[];
		destination: ArchiveType | null;
		writeStarted: boolean;
		readModelError: string | null;
		templateClassificationError: string | null;
	} = {
		sourceAccessors: [],
		destination: null,
		writeStarted: false,
		readModelError: null,
		templateClassificationError: null,
	};

	try {
		let pipeline = TaskList.from(undefined as void);
		for (const [index, inputPath] of inputPaths.entries()) {
			const label =
				inputPaths.length > 1
					? `Extract archive ${index + 1}/${inputPaths.length} (${path.basename(inputPath)})`
					: `Extract archive (${path.basename(inputPath)})`;
			pipeline = pipeline.pipe(label, async (_input: void, ctx: StepContext<void>) => {
				const reportProgress = dedupeProgressMessage((message) => ctx.progress(message));
				const accessor = await Archive.openCached(
					inputPath,
					(bytes, totalBytes) => reportProgress(formatByteProgress(bytes, totalBytes)),
					reportProgress,
				);
				state.sourceAccessors.push(accessor);
			});
		}

		pipeline = pipeline.pipe(
			'Create output archive',
			async (_input: void, ctx: StepContext<void>) => {
				ctx.progress('Creating');
				state.destination = await Archive.create({ filePath: outputPath, cwd });
			},
		);

		let concatResult: ConcatArchivesResult | null = null;
		const rowLabels = buildConcatRowLabels(inputPaths.length);
		pipeline = appendBridgedPhaseRows(pipeline, rowLabels, {
			run: async (_input: void, cb) => {
				const sources = inputPaths.map((p, i) => ({
					accessor: state.sourceAccessors[i]!,
					path: p,
				}));
				return await concatArchives({
					sources,
					destination: state.destination!,
					name: path.basename(outputPath, '.nitpicker'),
					callbacks: {
						onPhase: cb.onAdvance,
						onProgress: cb.onProgress,
					},
				});
			},
			onResult: (input, result) => {
				concatResult = result;
				return input;
			},
		});

		await pipeline.run({ stream, verbose, keepElapsed: true });

		const pendingState = await state.destination!.getCrawlingState();

		// The merged archive's templates are re-derived rather than copied: the
		// copied `page_templates` keys come from per-source clusterings whose
		// keys (`cluster:<n>`) collide across sources. Copied labels stay in
		// place — they seed label inheritance in this re-classification.
		let readModelPipeline = TaskList.from(state.destination!);
		if (!flags.skipTemplates) {
			readModelPipeline = readModelPipeline.pipe(
				'Classify page templates',
				async (destination: ArchiveType, ctx: StepContext<ArchiveType>) => {
					state.templateClassificationError = await classifyTemplatesQuietly(
						destination,
						(message) => {
							ctx.progress(message);
						},
					);
					return destination;
				},
			);
		}
		await appendViewerReadModelPhaseRows(
			readModelPipeline,
			VIEWER_READ_MODEL_FULL_BUILD_PHASES,
			{
				getArchive: (a: ArchiveType) => a,
				runBuild: buildViewerReadModelInWorker,
				onFailure: (error) => {
					state.readModelError = error instanceof Error ? error.message : String(error);
					return `Read model build failed: ${state.readModelError}`;
				},
			},
		).run({ stream, verbose, keepElapsed: true });

		await TaskList.pipe(
			'Write archive',
			async (_input: undefined, ctx: StepContext<void>) => {
				const reportProgress = dedupeProgressMessage((message) => ctx.progress(message));
				state.writeStarted = true;
				await state.destination!.write({
					onStep: (step) => reportProgress(WRITE_STEP_LABELS[step]),
					onTarProgress: (bytes, totalBytes) =>
						reportProgress(formatByteProgress(bytes, totalBytes)),
				});
			},
		).run({ stream, verbose, keepElapsed: true });

		// Best-effort cleanup after a successful write: every step that
		// mattered (transfer, read-model build, `write()`) has already
		// resolved, so a failure here is a harmless handle-release problem,
		// not a reason to fail a run whose output already exists on disk.
		for (const accessor of state.sourceAccessors) {
			await accessor.close().catch(() => {});
		}
		await state.destination!.close().catch(() => {});

		const result = concatResult!;
		const outcome: TransferOutcome = {
			outputPath,
			fromList: result.config.fromList,
			appendHintRoot: result.config.roots[0]!,
			externalInScopeCount: result.externalInScopeCount,
			pendingCount: pendingState.pending.length,
			readModelError: state.readModelError,
			templateClassificationError: state.templateClassificationError,
		};
		for (const line of formatTransferNotices(outcome)) {
			// eslint-disable-next-line no-console
			console.error(line);
		}
		process.exitCode = resolveTransferExitCode(outcome);
	} catch (error) {
		const cause = unwrapTaskListStepError(error);
		await cleanupFailedTransfer({
			sourceAccessors: state.sourceAccessors,
			destination: state.destination,
			writeStarted: state.writeStarted,
			outputPath: outputPath!,
		});
		formatCliError(cause, false);
		process.exit(ExitCode.Fatal);
	}
}
