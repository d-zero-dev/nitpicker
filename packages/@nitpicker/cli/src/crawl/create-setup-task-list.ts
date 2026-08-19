import type { StepContext } from '@d-zero/dealer';
import type { SetupPhaseLabel, SetupProgressCallbacks } from '@nitpicker/crawler';

import { TaskList } from '@d-zero/dealer';
import { SETUP_RECOVERY_PHASE_LABELS } from '@nitpicker/crawler';

import { dedupeProgressMessage } from '../dedupe-progress-message.js';
import { formatByteProgress } from '../format-byte-progress.js';
import { formatProgressCount } from '../format-progress-count.js';

import { createVerboseTimestampStream } from './create-verbose-timestamp-stream.js';

const RECOVERY_LABELS: ReadonlySet<string> = new Set(SETUP_RECOVERY_PHASE_LABELS);

/** The task-list row currently accepting `onPhase`/progress updates. */
interface ActiveStep {
	readonly ctx: StepContext<undefined>;
	/**
	 * Deduplicated on the rendered message (issue #294): raw byte/count
	 * callbacks fire once per ~64 KB chunk, far denser than a display needs —
	 * same rationale as `createByteProgressLogger`/`createCountProgressLogger`).
	 * Freshly created per row in `makeStep` so a new row's first message is
	 * never suppressed by the previous row's last one.
	 */
	readonly reportProgress: (message: string) => void;
	readonly resolve: (outcome: 'done' | 'skip') => void;
	readonly reject: (error: unknown) => void;
}

/** Return value of {@link createSetupTaskList}. */
export interface SetupTaskListHandle {
	/** Pass directly to `CrawlerOrchestrator.append`/`inventory`/`retryFailed`/`resume`. */
	readonly setupProgress: SetupProgressCallbacks;
	/**
	 * Resolves once every row has settled (all `done`/`skip`, or rejects with
	 * a `TaskListStepError` if one row's underlying setup step failed). Await
	 * this after {@link SetupTaskListHandle.finish} (success path) or
	 * alongside {@link SetupTaskListHandle.fail} (failure path, to observe
	 * and swallow the rejection before the caller re-throws its own error —
	 * otherwise the rejection goes unhandled).
	 */
	readonly taskListDone: Promise<void>;
	/**
	 * Call from `initializedCallback`, once crawling is about to take over
	 * the terminal. Marks the currently-active row done and any pre-built
	 * rows the setup phase never reached (an early-return branch, e.g.
	 * `inventory` with zero novel URLs) as skipped, then lets the task list
	 * finish so its `Lanes` releases before the crawl's own display starts.
	 */
	finish(): void;
	/**
	 * Call when the setup factory call itself rejects without ever invoking
	 * `initializedCallback` (mirrors the pre-TaskList `setupLanes.close()` on
	 * factory failure). Rejects the currently-active row with `error`; the
	 * task list stops immediately and every row after it stays `pending`.
	 * @param error - The error the factory call rejected with.
	 */
	fail(error: unknown): void;
}

/**
 * Bridges `CrawlerOrchestrator`'s `SetupProgressCallbacks` (issue #294) to a
 * `@d-zero/dealer` `TaskList` — one task-list row per entry in `phaseNames`
 * (the crawler's exported `*_SETUP_PHASES` constant for whichever mode is
 * running), pre-built up front so the operator sees the full row list from
 * the first frame instead of rows appearing one at a time.
 *
 * `onPhase` calls are trusted to arrive in the same order as `phaseNames` —
 * it does not match labels positionally against that array, since
 * `INVENTORY_SETUP_PHASES` reuses the label `'Loading crawl state'` at two
 * different positions and matching by string content would be ambiguous.
 * The one label-based check is against `SETUP_RECOVERY_PHASE_LABELS`
 * (`'Restoring archive from backup'` / `'Persisting ingested inventory
 * state'`) — labels that are never part of the planned sequence and can
 * arrive at any point once a failure diverts execution into a `.bak`
 * recovery path. An unplanned label is spliced in via `ctx.insertNext` right
 * after the row that was running when it arrived (so the interrupted row
 * still shows as `done` — this bridge does not attempt to retroactively mark
 * it failed; the real error surfaces separately once the factory call's
 * promise actually rejects), and any pre-built rows the run never reaches
 * are marked skipped once {@link SetupTaskListHandle.finish} runs.
 * @param phaseNames - The ordered phase labels to pre-build as rows (e.g.
 *   `RESUME_SETUP_PHASES`).
 * @param options - Display options.
 * @param options.verbose - Passed straight to `TaskList.run()`; also
 *   switches the render stream to one that prefixes every line with an ISO
 *   8601 timestamp.
 * @param options.stream - Render target. Defaults to `process.stderr`
 *   (progress is informational — see the CLI's stdout/stderr convention);
 *   overridable so tests don't have to render to the real terminal.
 * @returns A {@link SetupTaskListHandle}.
 * @example
 * ```ts
 * const setupTaskList = createSetupTaskList(RESUME_SETUP_PHASES, { verbose: false });
 * const orchestrator = await CrawlerOrchestrator.resume(
 *   stubPath,
 *   options,
 *   async (orchestrator, config) => {
 *     setupTaskList.finish();
 *     await setupTaskList.taskListDone; // Lanes released before crawling starts
 *   },
 *   setupTaskList.setupProgress,
 * );
 * ```
 */
export function createSetupTaskList(
	phaseNames: readonly string[],
	options: { readonly verbose: boolean; readonly stream?: NodeJS.WritableStream },
): SetupTaskListHandle {
	let active: ActiveStep | null = null;
	let skipRemaining = false;
	let finished = false;
	// The first `onPhase` call announces row 0, which is already the active
	// row from the moment `pipeline.run()` started — nothing to resolve yet.
	// Every call after that announces the NEXT row, which means the row that
	// was active until now just finished.
	let phaseCallCount = 0;

	const makeStep =
		(isPrebuilt: boolean) =>
		(_input: undefined, ctx: StepContext<undefined>): Promise<undefined> =>
			new Promise<undefined>((resolve, reject) => {
				if (isPrebuilt && skipRemaining) {
					ctx.progress('skipped');
					// eslint-disable-next-line unicorn/no-useless-undefined -- `Promise<undefined>`'s resolve requires the argument in this TS config; `Promise<void>` would let it be a `StepFn<undefined, void>` mismatch against the pipeline's carried `undefined` type instead
					resolve(undefined);
					return;
				}
				active = {
					ctx,
					reportProgress: dedupeProgressMessage((message) => {
						ctx.progress(message);
					}),
					resolve: (outcome) => {
						if (outcome === 'skip') {
							ctx.progress('skipped');
						}
						// eslint-disable-next-line unicorn/no-useless-undefined -- see above
						resolve(undefined);
					},
					reject,
				};
			});

	// eslint-disable-next-line unicorn/no-useless-undefined -- `from<T>(value: T)` has no optional/default parameter; omitting it is a TS2554 error
	let pipeline = TaskList.from(undefined);
	for (const name of phaseNames) {
		pipeline = pipeline.pipe(name, makeStep(true));
	}

	const baseStream = options.stream ?? process.stderr;
	const stream = options.verbose ? createVerboseTimestampStream(baseStream) : baseStream;
	const taskListDone = pipeline.run({ stream, verbose: options.verbose }).then(() => {});

	const advancePastActive = (label: SetupPhaseLabel) => {
		if (finished) {
			return;
		}
		phaseCallCount++;
		if (phaseCallCount === 1) {
			// Announces row 0, already active and displayed since
			// `pipeline.run()` started — nothing to resolve yet.
			return;
		}
		const previous = active;
		active = null;
		if (RECOVERY_LABELS.has(label)) {
			previous?.ctx.insertNext(label, makeStep(false));
		}
		previous?.resolve('done');
	};

	const reportBytes = (readOrCopiedBytes: number, totalBytes: number) => {
		active?.reportProgress(formatByteProgress(readOrCopiedBytes, totalBytes));
	};

	return {
		setupProgress: {
			onPhase: advancePastActive,
			onExtractProgress: reportBytes,
			onCopyProgress: reportBytes,
			onChunkProgress: (processed, total) => {
				active?.reportProgress(formatProgressCount(processed, total));
			},
		},
		taskListDone,
		finish() {
			if (finished) {
				return;
			}
			finished = true;
			skipRemaining = true;
			active?.resolve('done');
			active = null;
		},
		fail(error) {
			if (finished) {
				return;
			}
			finished = true;
			active?.reject(error);
			active = null;
		},
	};
}
