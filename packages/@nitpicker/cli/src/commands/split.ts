import type { commandDef } from './split-def.js';
import type { TransferOutcome } from '../transfer/types.js';
import type { StepContext } from '@d-zero/dealer';
import type { InferFlags } from '@d-zero/roar';
import type {
	ArchiveAccessor,
	Archive as ArchiveType,
	SplitArchiveResult,
} from '@nitpicker/crawler';

import path from 'node:path';

import { TaskList } from '@d-zero/dealer';
import {
	Archive,
	SPLIT_SOURCE_TRANSFER_PHASES,
	splitArchive,
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
import { validateSplitScopeUrls } from '../transfer/validate-split-scope-urls.js';
import { validateTransferInputPaths } from '../transfer/validate-transfer-input-paths.js';
import { validateTransferOutputPath } from '../transfer/validate-transfer-output-path.js';
import { TRANSFER_PHASE_LABELS } from '../transfer-phase-labels.js';
import { unwrapTaskListStepError } from '../unwrap-task-list-step-error.js';
import { VIEWER_READ_MODEL_FULL_BUILD_PHASES } from '../viewer-read-model-full-build-phases.js';
import { WRITE_STEP_LABELS } from '../write-step-labels.js';

/** Parsed flag values for the `split` CLI command. */
type SplitFlags = InferFlags<typeof commandDef.flags>;

/**
 * The flat row-label list for split's bridged `TaskList` rows — split
 * always has exactly one source, so this is simply
 * `SPLIT_SOURCE_TRANSFER_PHASES` followed by `TRANSFER_POST_PHASES`, with
 * no `(i/N)` suffix (unlike `concat`'s multi-source case).
 */
const SPLIT_ROW_LABELS: string[] = [
	...SPLIT_SOURCE_TRANSFER_PHASES.map((phase) => TRANSFER_PHASE_LABELS[phase]),
	...TRANSFER_POST_PHASES.map((phase) => TRANSFER_PHASE_LABELS[phase]),
];

/**
 * Main entry point for the `split` CLI command — extracts the pages under
 * the given scope URL(s) from a `.nitpicker` archive into a new archive.
 * See `docs/split.md` for the full extraction contract (scope semantics,
 * external stubbing, dropped rows) this command surfaces from
 * `@nitpicker/crawler`'s `splitArchive`.
 *
 * Structurally identical to `concat.ts` (see that file's docs for the
 * shared design: single `TaskList`, `Archive.openCached` sources,
 * `cleanupFailedTransfer` on any failure, notices only after the list
 * settles) with exactly one source and no `(i/N)` row suffixing.
 * @param args - Positional arguments: the archive path, then one or more scope URLs.
 * @param flags - Parsed CLI flags from the `split` command.
 * @returns Resolves when the extraction completes. Exits with code 1 on
 *   validation/pipeline failure, 2 if pending is non-empty or the
 *   template classification / read-model build failed, 0 otherwise.
 */
export async function split(args: string[], flags: SplitFlags): Promise<void> {
	if (!flags.output) {
		// eslint-disable-next-line no-console
		console.error('Error: -o/--output is required.');
		// eslint-disable-next-line no-console
		console.error(
			'Usage: npx @nitpicker/cli split <archive> <URL> [<URL>...] -o <output> [--skip-templates] [--verbose]',
		);
		process.exit(ExitCode.Fatal);
	}

	const cwd = process.cwd();
	let inputPath: string;
	let scopeUrls: string[];
	let outputPath: string;
	try {
		const [archivePath, ...urlArgs] = args;
		if (!archivePath) {
			throw new Error('split requires an archive path');
		}
		inputPath = validateTransferInputPaths([archivePath], cwd)[0]!;
		scopeUrls = validateSplitScopeUrls(urlArgs);
		outputPath = validateTransferOutputPath(flags.output, cwd);
	} catch (error) {
		formatCliError(error, false);
		process.exit(ExitCode.Fatal);
	}

	const verbose = !!flags.verbose;
	const baseStream = process.stderr;
	const stream = verbose ? createVerboseTimestampStream(baseStream) : baseStream;

	const state: {
		sourceAccessor: ArchiveAccessor | null;
		destination: ArchiveType | null;
		writeStarted: boolean;
		readModelError: string | null;
		templateClassificationError: string | null;
	} = {
		sourceAccessor: null,
		destination: null,
		writeStarted: false,
		readModelError: null,
		templateClassificationError: null,
	};

	try {
		let pipeline = TaskList.pipe(
			`Extract archive (${path.basename(inputPath!)})`,
			async (_input: void, ctx: StepContext<void>) => {
				const reportProgress = dedupeProgressMessage((message) => ctx.progress(message));
				const accessor = await Archive.openCached(
					inputPath,
					(bytes, totalBytes) => reportProgress(formatByteProgress(bytes, totalBytes)),
					reportProgress,
				);
				state.sourceAccessor = accessor;
			},
		);

		pipeline = pipeline.pipe(
			'Create output archive',
			async (_input: void, ctx: StepContext<void>) => {
				ctx.progress('Creating');
				state.destination = await Archive.create({ filePath: outputPath, cwd });
			},
		);

		let splitResult: SplitArchiveResult | null = null;
		pipeline = appendBridgedPhaseRows(pipeline, SPLIT_ROW_LABELS, {
			run: async (_input: void, cb) => {
				return await splitArchive({
					source: { accessor: state.sourceAccessor!, path: inputPath },
					scopeUrls,
					destination: state.destination!,
					name: path.basename(outputPath, '.nitpicker'),
					callbacks: {
						onPhase: cb.onAdvance,
						onProgress: cb.onProgress,
					},
				});
			},
			onResult: (input, result) => {
				splitResult = result;
				return input;
			},
		});

		await pipeline.run({ stream, verbose, keepElapsed: true });

		const pendingState = await state.destination!.getCrawlingState();

		// Templates are re-derived from the extracted pages rather than copied
		// as-is: the source's clusters were computed over the whole source
		// archive, so a cluster's membership (and its stored reason) no longer
		// describes the subset. Copied labels stay in place — they seed label
		// inheritance in this re-classification.
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

		// Best-effort cleanup after a successful write — see `concat.ts`'s
		// identical comment for why a failure here is harmless.
		await state.sourceAccessor!.close().catch(() => {});
		await state.destination!.close().catch(() => {});

		const result = splitResult!;
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
			sourceAccessors: state.sourceAccessor ? [state.sourceAccessor] : [],
			destination: state.destination,
			writeStarted: state.writeStarted,
			outputPath: outputPath!,
		});
		formatCliError(cause, false);
		process.exit(ExitCode.Fatal);
	}
}
