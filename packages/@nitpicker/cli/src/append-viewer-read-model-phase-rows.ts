import type { StepContext, TaskListPipeline } from '@d-zero/dealer';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type {
	BuildViewerReadModelOptions,
	ViewerReadModelBuildPhase,
	ViewerReadModelBuildProgress,
} from '@nitpicker/query';

import { formatProgressCount } from './format-progress-count.js';
import { VIEWER_READ_MODEL_PHASE_LABELS } from './viewer-read-model-phase-labels.js';
import { PROGRESS_UNIT_BY_PHASE } from './viewer-read-model-progress-unit-by-phase.js';

/** Options for {@link appendViewerReadModelPhaseRows}. */
export interface AppendViewerReadModelPhaseRowsOptions<T> {
	/** Extracts the writable archive accessor {@link AppendViewerReadModelPhaseRowsOptions.runBuild} operates against, from the pipeline's current value. */
	readonly getArchive: (value: T) => ArchiveAccessor;
	/**
	 * The read-model operation driving every row's `onPhase`/`onProgress` —
	 * `buildViewerReadModelInWorker` or `runViewerReadModelBackfillsInWorker`
	 * (both `@nitpicker/query`), whichever matches the `phases` array passed
	 * to {@link appendViewerReadModelPhaseRows}.
	 */
	readonly runBuild: (
		accessor: ArchiveAccessor,
		options: BuildViewerReadModelOptions,
	) => Promise<void>;
	/**
	 * When present, a `runBuild` rejection never rejects the pipeline: the
	 * row active at the time of failure shows this callback's return value
	 * and settles `done`, every not-yet-reached row shows `'skipped'` and
	 * settles `done` too, and the pipeline resolves normally (the
	 * crawl-completion contract: a read-model failure must never block
	 * `orchestrator.write()`). Omit to fail loud instead — the active row
	 * rejects with the raw error, surfacing as a `TaskListStepError` from
	 * `.run()` (`viewer-build`'s contract: a failure triggers its `.bak`
	 * restore).
	 */
	readonly onFailure?: (error: unknown) => string;
}

/** The task-list row currently accepting `onPhase`/`onProgress` updates. */
interface ActiveRow<T> {
	readonly ctx: StepContext<T>;
	readonly resolve: () => void;
	readonly reject: (error: unknown) => void;
}

/**
 * Appends one `@d-zero/dealer` `TaskList` row per entry in `phases` to
 * `pipeline`, each row settling in step with a single underlying
 * `runBuild(...)` call's `onPhase` progression (issue #294) — a full
 * expansion of `buildViewerReadModel`'s internal phases into individual
 * rows, rather than one row whose message is swapped via `ctx.progress()`
 * on each phase change.
 *
 * `phases` must be the exact, ordered phase sequence `runBuild` actually
 * announces (see `VIEWER_READ_MODEL_FULL_BUILD_PHASES` /
 * `VIEWER_READ_MODEL_BACKFILL_PHASES`, both statically verified against their
 * respective `onPhase` call sites) — every phase in this codebase is
 * unconditional and branch-free, so unlike
 * `crawl/create-setup-task-list.ts`'s setup-phase bridge, no `insertNext`
 * splicing for unplanned labels or early-return skip handling is needed
 * here.
 *
 * Mechanics: only the first row's step function actually starts `runBuild`
 * (guarded so a later row re-entering this code path — impossible in
 * practice, since each `.pipe()` step runs exactly once — would still be a
 * no-op). Each `onPhase` call resolves the currently active row and makes
 * the next one active (the first call is a no-op — row 0 is already active
 * the moment `pipeline.run()` reaches it). The last row has no successor
 * `onPhase` call to resolve it, so it resolves instead when `runBuild`'s own
 * promise resolves. A `runBuild` rejection resolves or rejects whichever row
 * is active at that moment, depending on
 * {@link AppendViewerReadModelPhaseRowsOptions.onFailure}.
 * @param pipeline - The in-progress pipeline to extend.
 * @param phases - The ordered phase sequence to render as rows.
 * @param options - See {@link AppendViewerReadModelPhaseRowsOptions}.
 * @returns The extended pipeline, still carrying `T` through unchanged (the
 *   read-model build has no output of its own — every row passes its input
 *   straight through).
 * @example
 * ```ts
 * const archive = await TaskList.from(archive)
 *   .pipe(...)
 *   .run({ stream, verbose, keepElapsed: true });
 * await appendViewerReadModelPhaseRows(TaskList.from(archive), VIEWER_READ_MODEL_FULL_BUILD_PHASES, {
 *   getArchive: (a) => a,
 *   runBuild: buildViewerReadModelInWorker,
 * }).run({ stream, verbose, keepElapsed: true });
 * ```
 */
export function appendViewerReadModelPhaseRows<T>(
	pipeline: TaskListPipeline<T>,
	phases: readonly ViewerReadModelBuildPhase[],
	options: AppendViewerReadModelPhaseRowsOptions<T>,
): TaskListPipeline<T> {
	const bridge: {
		active: ActiveRow<T> | null;
		currentPhase: ViewerReadModelBuildPhase | undefined;
		phaseCallCount: number;
		skipRemaining: boolean;
		started: boolean;
	} = {
		active: null,
		currentPhase: undefined,
		phaseCallCount: 0,
		skipRemaining: false,
		started: false,
	};

	const onPhase = (phase: ViewerReadModelBuildPhase) => {
		bridge.currentPhase = phase;
		bridge.phaseCallCount++;
		if (bridge.phaseCallCount === 1) {
			// Announces row 0, already active and displayed since this row's
			// step function ran — nothing to resolve yet.
			return;
		}
		const previous = bridge.active;
		bridge.active = null;
		previous?.resolve();
	};

	const onProgress = (progress: ViewerReadModelBuildProgress) => {
		const unit =
			(bridge.currentPhase && PROGRESS_UNIT_BY_PHASE[bridge.currentPhase]) || 'pages';
		bridge.active?.ctx.progress(
			formatProgressCount(progress.insertedRows, progress.totalRows, unit),
		);
	};

	const start = (accessor: ArchiveAccessor) => {
		if (bridge.started) {
			return;
		}
		bridge.started = true;
		options.runBuild(accessor, { onPhase, onProgress }).then(
			() => {
				bridge.active?.resolve();
				bridge.active = null;
			},
			(error: unknown) => {
				const failed = bridge.active;
				bridge.active = null;
				if (options.onFailure) {
					failed?.ctx.progress(options.onFailure(error));
					bridge.skipRemaining = true;
					failed?.resolve();
				} else {
					failed?.reject(error);
				}
			},
		);
	};

	let result = pipeline;
	for (const phase of phases) {
		result = result.pipe(
			VIEWER_READ_MODEL_PHASE_LABELS[phase],
			(input: T, ctx: StepContext<T>): Promise<T> =>
				new Promise<T>((resolve, reject) => {
					if (bridge.skipRemaining) {
						ctx.progress('skipped');
						resolve(input);
						return;
					}
					bridge.active = { ctx, resolve: () => resolve(input), reject };
					start(options.getArchive(input));
				}),
		);
	}
	return result;
}
