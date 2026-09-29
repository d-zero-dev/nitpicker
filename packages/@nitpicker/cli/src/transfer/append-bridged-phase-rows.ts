import type { StepContext, TaskListPipeline } from '@d-zero/dealer';

/** Options for {@link appendBridgedPhaseRows}. */
export interface AppendBridgedPhaseRowsOptions<T, R> {
	/**
	 * Starts the single underlying operation this call renders as one row
	 * per label. Called exactly once, by the first row's step function.
	 * `onAdvance` must be called once per phase boundary the operation
	 * crosses, in the SAME order and count as `rowLabels` — this bridge
	 * does not itself know what a "phase" means, it only counts advances.
	 * `onProgress` renders on whichever row is currently active.
	 */
	readonly run: (
		input: T,
		callbacks: {
			readonly onAdvance: () => void;
			readonly onProgress: (processed: number, total: number) => void;
		},
	) => Promise<R>;
	/** Merges the operation's result into the pipeline's carried value for the next step. */
	readonly onResult: (input: T, result: R) => T;
	/**
	 * When present, a `run` rejection never rejects the pipeline: the row
	 * active at failure time shows this callback's return value and
	 * settles `done`, every not-yet-reached row shows `'skipped'`, and the
	 * pipeline resolves with the input UNCHANGED (the caller must inspect
	 * its own failure state separately — this bridge has no result to
	 * carry forward on failure). Omit to fail loud instead — the active
	 * row rejects with the raw error, surfacing as a `TaskListStepError`.
	 */
	readonly onFailure?: (error: unknown) => string;
}

/** The task-list row currently accepting advance/progress updates. */
interface ActiveRow<T> {
	readonly ctx: StepContext<T>;
	readonly resolve: () => void;
	readonly reject: (error: unknown) => void;
}

/**
 * Appends one `@d-zero/dealer` `TaskList` row per label in `rowLabels`,
 * each row settling in step with a single underlying `run(...)` call's
 * `onAdvance` progression — the same "full expansion of an operation's
 * internal phases into individual rows" mechanics as
 * `append-viewer-read-model-phase-rows.ts`'s `appendViewerReadModelPhaseRows`,
 * generalised so a caller supplies plain labels instead of a typed phase
 * enum: `concat`/`split`'s phase callback carries a `(sourceIndex, phase)`
 * pair whose exact values this bridge does not need to inspect — every
 * `onPhase` firing from `transferArchiveRows`/`concatArchives`/
 * `splitArchive` maps 1:1 to the next `onAdvance()` call, in the fixed,
 * unconditional order those functions document.
 * @param pipeline - The in-progress pipeline to extend.
 * @param rowLabels - One label per row, in the exact order `run`'s
 *   `onAdvance` calls will arrive.
 * @param options - See {@link AppendBridgedPhaseRowsOptions}.
 * @returns A new pipeline whose value is `options.onResult`'s output (or,
 *   on a handled failure, the original input unchanged).
 * @example
 * ```ts
 * const pipeline = appendBridgedPhaseRows(TaskList.from(state), rowLabels, {
 *   run: (state, cb) => concatArchives({ ...state, callbacks: { onPhase: cb.onAdvance, onProgress: cb.onProgress } }),
 *   onResult: (state, result) => ({ ...state, result }),
 * });
 * ```
 */
export function appendBridgedPhaseRows<T, R>(
	pipeline: TaskListPipeline<T>,
	rowLabels: readonly string[],
	options: AppendBridgedPhaseRowsOptions<T, R>,
): TaskListPipeline<T> {
	const bridge: {
		active: ActiveRow<T> | null;
		advanceCount: number;
		skipRemaining: boolean;
		started: boolean;
		input: T | null;
	} = {
		active: null,
		advanceCount: 0,
		skipRemaining: false,
		started: false,
		input: null,
	};

	const onAdvance = () => {
		bridge.advanceCount++;
		if (bridge.advanceCount === 1) {
			// Announces row 0, already active since this row's step function
			// ran — nothing to resolve yet.
			return;
		}
		const previous = bridge.active;
		bridge.active = null;
		previous?.resolve();
	};

	const onProgress = (processed: number, total: number) => {
		bridge.active?.ctx.progress(`${processed}/${total}`);
	};

	const start = (input: T) => {
		if (bridge.started) {
			return;
		}
		bridge.started = true;
		bridge.input = input;
		options.run(input, { onAdvance, onProgress }).then(
			(result) => {
				bridge.input = options.onResult(input, result);
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
	for (const label of rowLabels) {
		result = result.pipe(
			label,
			(input: T, ctx: StepContext<T>): Promise<T> =>
				new Promise<T>((resolve, reject) => {
					if (bridge.skipRemaining) {
						ctx.progress('skipped');
						resolve(bridge.input ?? input);
						return;
					}
					bridge.active = {
						ctx,
						resolve: () => resolve(bridge.input ?? input),
						reject,
					};
					start(input);
				}),
		);
	}
	return result;
}
