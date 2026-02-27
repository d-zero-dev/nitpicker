/**
 * Data payload passed to a Worker thread via `workerData`.
 *
 * This type merges the worker infrastructure fields (`filePath`, `num`, `total`)
 * with the caller-supplied initial data (`I`). The `filePath` points to the
 * module whose default export will be invoked by the {@link ../runner.ts!runner}.
 * @template I - Shape of the additional data the caller provides
 *   (e.g. {@link ../../page-analysis-worker.ts!PageAnalysisWorkerData}).
 * @see {@link ../run-in-worker.ts!runInWorker} for where this payload is constructed
 * @see {@link ../runner.ts!runner} for where it is consumed
 */
export type WorkerData<I extends Record<string, unknown>> = {
	/**
	 * Absolute path to the compiled JS module to `import()` and execute.
	 * The module must export a default function matching the
	 * `(data, emitter, num, total) => Promise<R>` signature.
	 */
	filePath: string;

	/** Zero-based index of the current item in the batch (for progress tracking). */
	num: number;

	/** Total number of items in the batch (for progress tracking). */
	total: number;
} & I;
